//! Partsong's music reader: homr's pipeline (homr-rs) with Partsong's layout
//! rules (layout.rs), driven from omr-worker.js, which runs the three models
//! with onnxruntime-web. One page at a time:
//!
//!   page_open(rgba, w, h, systems)  -> number of segnet tiles
//!   tile(i)                         -> segnet input for tile i (3x320x320 f32)
//!   page_segment(classes)           -> staffs found (argmax of segnet per tile)
//!   page_layout()                   -> its systems, before reading (JSON in msg)
//!   page_step()                     -> 1: a staff to read (staff_input), 0: done (MusicXML in msg)
//!   staff_result(tokens, attention) -> what the transformer read on that staff
//!
//! Errors return -1 with the message in msg (homr's own messages, e.g. "No
//! staffs found").

pub mod layout;
pub mod staffs;

use homr_rs::braces::MultiStaff;
use homr_rs::musicxml::{generate_xml_with, XmlOptions};
use homr_rs::page::PageMasks;
use staffs::analyse_page;
use homr_rs::preprocess::{autocrop, bgr_to_gray, clahe, masks, merge_tiles, postprocess, resize_image, tile_input, tile_origins, Bgr, WIN};
use homr_rs::score::{symbol_center, PageMapping};
use homr_rs::staff::Staff;
use homr_rs::staff_image::{prepare_staff, to_model_input, Regions, StaffMapping};
use homr_rs::tokens::{is_lower, Symbol, Vocab};
use homr_rs::warp::Gray;
use layout::{drop_false_key_changes, layout_systems, parse_staffs_by_layout, Reader, Row, Stop};
use std::cell::RefCell;
use std::collections::HashMap;

type Key = [u64; 5];

fn key(s: &Staff) -> Key {
    [s.min_x.to_bits(), s.min_y.to_bits(), s.max_x.to_bits(), s.max_y.to_bits(), s.grid.len() as u64]
}

struct Pending {
    key: Key,
    grand: bool,
    mapping: StaffMapping,
    boxes: [[f64; 4]; 2], // upper, lower: where the staff is on the input image
}

pub struct Page {
    gray: Gray,
    origins: Vec<(i64, i64)>,
    crop: (usize, usize),
    cropped: (usize, usize),
    mapping: Option<PageMapping>,
    multi: Vec<MultiStaff>,
    user_ranges: Vec<(f64, f64)>,
    read: HashMap<Key, Vec<Symbol>>,
    pending: Option<Pending>,
    input: Vec<f32>,
    input_dims: (usize, usize),
    vocab: Vocab,
}

impl Reader for Page {
    /// staff_parsing.parse_staff_image with runner.py's _parse_staff_image_once:
    /// each staff is read once per page, the first time it's asked for.
    fn read(&mut self, staff: &Staff, grand: bool, regions: &Regions) -> Result<Vec<Symbol>, Stop> {
        let k = key(staff);
        if let Some(s) = self.read.get(&k) {
            return Ok(s.clone());
        }
        let prepared = prepare_staff(staff, &self.gray, regions)?;
        let (upper, lower) = match staff.halves.as_deref() {
            Some((a, b)) => (a, b),
            None => (staff, staff),
        };
        let bx = |st: &Staff| {
            let (x0, y0) = self.to_input((st.min_x, st.min_y));
            let (x1, y1) = self.to_input((st.max_x, st.max_y));
            [x0, y0, x1, y1]
        };
        let boxes = [bx(upper), bx(lower)];
        self.input = to_model_input(&prepared.canvas);
        self.input_dims = (prepared.canvas.h, prepared.canvas.w);
        self.pending = Some(Pending { key: k, grand, mapping: prepared.mapping, boxes });
        Err(Stop::Need)
    }
    fn to_input(&self, p: (f64, f64)) -> (f64, f64) {
        self.mapping.as_ref().unwrap().apply(p)
    }
}

/// runner.py's build_image_position patch: the voice homr's model gave the
/// note, and where its staff is on the photo.
fn note_comments(s: &Symbol) -> Vec<String> {
    let mut out = vec![format!(" homr-voice: {} ", s.position)];
    if !s.extra.is_empty() {
        out.push(format!(" staff-box: {} ", s.extra.join(", ")));
    }
    out
}

impl Page {
    pub fn open(bgr: Bgr, user_ranges: Vec<(f64, f64)>) -> Page {
        // preprocess(), keeping the cropped size: positions map back through it
        let (cropped, crop) = autocrop(&bgr);
        let gray = clahe(&bgr_to_gray(&resize_image(&cropped)));
        let origins = tile_origins(gray.h, gray.w);
        Page {
            cropped: (cropped.h, cropped.w),
            crop,
            gray,
            origins,
            mapping: None,
            multi: vec![],
            user_ranges,
            read: HashMap::new(),
            pending: None,
            input: vec![],
            input_dims: (0, 0),
            vocab: Vocab::default(),
        }
    }

    pub fn tiles(&self) -> usize {
        self.origins.len()
    }

    pub fn tile(&self, i: usize) -> Vec<f32> {
        let (y, x) = self.origins[i];
        tile_input(&self.gray, y, x)
    }

    /// The segmentation (each tile's class map) to the page's staffs.
    pub fn segment(&mut self, classes: &[Vec<u8>]) -> Result<(), String> {
        let (h, w) = (self.gray.h, self.gray.w);
        let merged = merge_tiles(classes, h, w);
        let m = postprocess(masks(&merged, h, w), &mut self.gray);
        self.mapping = Some(PageMapping { cropped: self.cropped, preprocessed: (h, w), crop: (self.crop.0 as f64, self.crop.1 as f64) });
        let pm = PageMasks { h, w, notehead: &m.notehead, symbols: &m.symbols, staff: &m.staff, clefs_keys: &m.clefs_keys, stem_rests: &m.stems_rest };
        // Not homr's repair_systems: Partsong's own layout rules group the
        // systems (repair_systems split Of a Rose's pages 2, 4, 8 and 10 wrongly).
        self.multi = analyse_page(&pm)?;
        Ok(())
    }

    /// Ok(Some(xml)) when done, Ok(None) when a staff needs reading (input()).
    pub fn step(&mut self) -> Result<Option<String>, String> {
        let rows: Vec<Row> = self.multi.iter().map(|m| Row { staffs: m.staffs.iter().cloned().zip(m.grand.iter().copied()).collect() }).collect();
        let ranges = self.user_ranges.clone();
        match parse_staffs_by_layout(rows, &ranges, self) {
            Err(Stop::Need) => Ok(None),
            Err(Stop::Error(e)) => Err(e),
            Ok(voices) => {
                let voices: Vec<Vec<Symbol>> = voices.into_iter().map(drop_false_key_changes).collect();
                let opts = XmlOptions { note_comments: Some(note_comments) };
                generate_xml_with(&voices, "", opts).map(Some)
            }
        }
    }

    /// As JSON: the systems top to bottom, per system its staves (a grand
    /// staff as its two halves), each [x0, y0, x1, y1] on the input image;
    /// and the parts they give, as each part's staves (1, or 2 for a grand staff).
    pub fn layout(&self) -> String {
        let rows: Vec<Row> = self.multi.iter().map(|m| Row { staffs: m.staffs.iter().cloned().zip(m.grand.iter().copied()).collect() }).collect();
        let (systems, parts) = layout_systems(rows, &self.user_ranges, self);
        let bx = |st: &Staff| {
            let (x0, y0) = self.to_input((st.min_x, st.min_y));
            let (x1, y1) = self.to_input((st.max_x, st.max_y));
            format!("[{},{},{},{}]", x0.round(), y0.round(), x1.round(), y1.round())
        };
        let sys: Vec<String> = systems
            .iter()
            .map(|r| {
                let staves: Vec<String> = r
                    .staffs
                    .iter()
                    .flat_map(|(st, _)| match st.halves.as_deref() {
                        Some((a, b)) => vec![bx(a), bx(b)],
                        None => vec![bx(st)],
                    })
                    .collect();
                format!("[{}]", staves.join(","))
            })
            .collect();
        let parts: Vec<&str> = parts.iter().map(|&g| if g { "2" } else { "1" }).collect();
        format!("{{\"systems\":[{}],\"parts\":[{}]}}", sys.join(","), parts.join(","))
    }

    pub fn input(&self) -> (&[f32], (usize, usize)) {
        (&self.input, self.input_dims)
    }

    /// What the transformer read on the pending staff: per step its six
    /// tokens (rhythm, pitch, lift, position, articulation, slur) and its
    /// attention (the first two values are the symbol's position).
    pub fn staff_result(&mut self, tokens: &[i32], attention: &[f32]) {
        let p = self.pending.take().expect("no staff pending");
        let steps = tokens.len() / 6;
        let per = if steps > 0 { attention.len() / steps } else { 0 };
        let mut symbols = Vec::new();
        for i in 0..steps {
            let t = &tokens[i * 6..i * 6 + 6];
            let coords: Vec<f64> = attention[i * per..(i + 1) * per].iter().map(|&v| v as f64).collect();
            if let Some(s) = self.vocab.symbol([t[0] as usize, t[1] as usize, t[2] as usize, t[3] as usize, t[4] as usize, t[5] as usize], Some(coords)) {
                symbols.push(s);
            }
        }
        // predict_best: a single staff keeps the upper voices only
        if !p.grand {
            symbols.retain(|s| !is_lower(&s.position));
        }
        for s in &mut symbols {
            if let Some(c) = symbol_center(s) {
                s.image_coordinates = Some(self.to_input(p.mapping.to_page(c)));
            }
            if s.rhythm.starts_with("note") || s.rhythm.starts_with("rest") {
                let b = p.boxes[is_lower(&s.position) as usize];
                s.extra = b.iter().map(|v| format!("{}", v.round_ties_even() as i64)).collect();
            }
        }
        self.read.insert(p.key, symbols);
    }
}

// ---- WebAssembly interface (no bindings generator: plain exports) ----

thread_local! {
    static PAGE: RefCell<Option<Page>> = const { RefCell::new(None) };
    static MSG: RefCell<String> = const { RefCell::new(String::new()) };
    static BUF: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

fn set_msg(s: String) {
    MSG.with(|m| *m.borrow_mut() = s);
}

#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n));
}

#[no_mangle]
pub extern "C" fn msg_ptr() -> *const u8 {
    MSG.with(|m| m.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn msg_len() -> usize {
    MSG.with(|m| m.borrow().len())
}

#[no_mangle]
pub extern "C" fn buf_ptr() -> *const f32 {
    BUF.with(|b| b.borrow().as_ptr())
}

/// The page as RGBA pixels; systems: JSON-ish list of numbers
/// (top, bottom, top, bottom, ...) as f64s, the user's systems if fixed.
#[no_mangle]
pub unsafe extern "C" fn page_open(rgba: *const u8, w: usize, h: usize, systems: *const f64, n_systems: usize) -> i32 {
    let px = std::slice::from_raw_parts(rgba, w * h * 4);
    let mut data = Vec::with_capacity(w * h * 3);
    for p in px.chunks_exact(4) {
        data.extend_from_slice(&[p[2], p[1], p[0]]); // cv2.imread: BGR, alpha dropped
    }
    let ranges = if n_systems > 0 { std::slice::from_raw_parts(systems, n_systems * 2).chunks_exact(2).map(|c| (c[0], c[1])).collect() } else { vec![] };
    let page = Page::open(Bgr { w, h, data }, ranges);
    let n = page.tiles();
    PAGE.with(|p| *p.borrow_mut() = Some(page));
    n as i32
}

#[no_mangle]
pub extern "C" fn tile(i: usize) -> *const f32 {
    let t = PAGE.with(|p| p.borrow().as_ref().unwrap().tile(i));
    BUF.with(|b| *b.borrow_mut() = t);
    buf_ptr()
}

/// classes: one u8 class map (320x320) per tile, in tile order.
#[no_mangle]
pub unsafe extern "C" fn page_segment(classes: *const u8) -> i32 {
    PAGE.with(|p| {
        let mut p = p.borrow_mut();
        let page = p.as_mut().unwrap();
        let all = std::slice::from_raw_parts(classes, page.tiles() * WIN * WIN);
        let maps: Vec<Vec<u8>> = all.chunks_exact(WIN * WIN).map(|c| c.to_vec()).collect();
        match page.segment(&maps) {
            Ok(()) => 0,
            Err(e) => {
                set_msg(e);
                -1
            }
        }
    })
}

/// Drops the open page, so the next page_open reuses its memory in the same
/// instance (WebAssembly memory never shrinks; with a fresh instance per page,
/// the old one waited for Safari to free it, and the next page's opening went
/// on top of it: about 1 GB for a moment on the iPhone simulator, 0.75 GB with
/// this).
#[no_mangle]
pub extern "C" fn page_close() {
    PAGE.with(|p| *p.borrow_mut() = None);
    BUF.with(|b| *b.borrow_mut() = Vec::new());
}

/// After page_segment: the page's systems (Page::layout) in msg.
#[no_mangle]
pub extern "C" fn page_layout() -> usize {
    let json = PAGE.with(|p| p.borrow().as_ref().unwrap().layout());
    let n = json.len();
    set_msg(json);
    n
}

#[no_mangle]
pub extern "C" fn page_step() -> i32 {
    PAGE.with(|p| {
        let mut p = p.borrow_mut();
        let page = p.as_mut().unwrap();
        match page.step() {
            Ok(Some(xml)) => {
                set_msg(xml);
                0
            }
            Ok(None) => {
                let (data, _) = page.input();
                BUF.with(|b| *b.borrow_mut() = data.to_vec());
                1
            }
            Err(e) => {
                set_msg(e);
                -1
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn staff_input_h() -> usize {
    PAGE.with(|p| p.borrow().as_ref().unwrap().input_dims.0)
}

#[no_mangle]
pub extern "C" fn staff_input_w() -> usize {
    PAGE.with(|p| p.borrow().as_ref().unwrap().input_dims.1)
}

#[no_mangle]
pub unsafe extern "C" fn staff_result(tokens: *const i32, n_tokens: usize, attention: *const f32, n_attention: usize) {
    let t = std::slice::from_raw_parts(tokens, n_tokens);
    let a = std::slice::from_raw_parts(attention, n_attention);
    PAGE.with(|p| p.borrow_mut().as_mut().unwrap().staff_result(t, a));
}
