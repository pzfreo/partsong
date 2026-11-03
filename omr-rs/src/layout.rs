//! Partsong's changes to how homr groups staves and cleans up what it read
//! (formerly omr/runner.py, which patched homr in Pyodide). Each function
//! names the runner.py function it replaces.

use homr_rs::score::{ensure_same_number_of_staffs, find_periodic_core, sorted_row, Row};
use homr_rs::staff::Staff;
use homr_rs::staff_image::Regions;
use homr_rs::tokens::{remove_duplicated_symbols, Symbol, EMPTY, NONOTE};

/// Reads one staff: its symbols, or why it can't yet (see lib.rs).
pub trait Reader {
    fn read(&mut self, staff: &Staff, grand: bool, regions: &Regions) -> Result<Vec<Symbol>, Stop>;
    fn to_input(&self, p: (f64, f64)) -> (f64, f64);
}

pub enum Stop {
    /// the transformer hasn't read this staff yet
    Need,
    Error(String),
}

impl From<String> for Stop {
    fn from(e: String) -> Stop {
        Stop::Error(e)
    }
}

fn kinds(r: &Row) -> Vec<bool> {
    r.staffs.iter().map(|s| s.1).collect()
}

fn regions(rows: &[Row]) -> Regions {
    Regions { centers: rows.iter().flat_map(|r| r.staffs.iter().map(|s| (s.0.min_y, s.0.max_y))).collect() }
}

fn is_note_or_rest(s: &Symbol) -> bool {
    s.rhythm.starts_with("note") || s.rhythm.starts_with("rest")
}

/// _split_false_grand_staffs: a grand staff without a bass clef read below
/// is read as its two staves.
fn split_false_grand_staffs(rows: Vec<Row>, reader: &mut dyn Reader) -> Result<Vec<Row>, Stop> {
    let reg = regions(&rows);
    let mut out = Vec::new();
    for row in rows {
        let mut staffs = Vec::new();
        for (staff, grand) in row.staffs {
            if let Some(halves) = staff.halves.as_deref() {
                let symbols = reader.read(&staff, grand, &reg)?;
                let first = symbols.iter().position(is_note_or_rest).unwrap_or(symbols.len());
                let mut lower: Option<String> = None;
                for s in &symbols[..first] {
                    if s.rhythm.starts_with("clef") && s.position == "lower" {
                        lower = Some(s.rhythm.chars().skip(5).take(1).collect());
                    }
                }
                if lower.as_deref() != Some("F") {
                    staffs.push((halves.0.clone(), false));
                    staffs.push((halves.1.clone(), false));
                    continue;
                }
            }
            staffs.push((staff, grand));
        }
        out.push(sorted_row(staffs));
    }
    Ok(out)
}

/// _user_systems: the systems the user marked (Fix systems), as ranges of y
/// on the input image.
fn user_systems(rows: Vec<Row>, ranges: &[(f64, f64)], reader: &dyn Reader) -> Vec<Row> {
    let middle = |s: &Staff| reader.to_input(((s.min_x + s.max_x) / 2.0, (s.min_y + s.max_y) / 2.0)).1;
    let mut widths: Vec<f64> = rows.iter().flat_map(|r| r.staffs.iter().map(|s| s.0.max_x - s.0.min_x)).collect();
    widths.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let width = widths[widths.len() / 2];
    let mut chosen: Vec<Vec<(Staff, bool)>> = vec![vec![]; ranges.len()];
    let mut rest = Vec::new();
    for row in rows {
        let mut left = Vec::new();
        for st in row.staffs {
            if st.0.max_x - st.0.min_x < 0.6 * width {
                continue;
            }
            let y = middle(&st.0);
            match ranges.iter().position(|&(top, bottom)| top <= y && y <= bottom) {
                Some(k) => chosen[k].push(st),
                None => left.push(st),
            }
        }
        if !left.is_empty() {
            rest.push(sorted_row(left));
        }
    }
    let mut systems: Vec<Row> = chosen.into_iter().filter(|c| !c.is_empty()).map(sorted_row).collect();
    systems.extend(rest);
    systems.sort_by(|a, b| a.staffs[0].0.min_y.partial_cmp(&b.staffs[0].0.min_y).unwrap());
    systems
}

/// _join_split_rows: join a row to the grand staff row below it when together
/// they're the shape of another system and no further apart than its staves.
fn join_split_rows(mut rows: Vec<Row>) -> Vec<Row> {
    let inner_gap = |r: &Row| r.staffs.windows(2).map(|p| p[1].0.min_y - p[0].0.max_y).fold(f64::NEG_INFINITY, f64::max);
    let mut i = 0;
    while i + 1 < rows.len() {
        let (a, b) = (&rows[i], &rows[i + 1]);
        let mut both = kinds(a);
        both.extend(kinds(b));
        let alike: Vec<&Row> = rows.iter().enumerate().filter(|(j, r)| *j != i && *j != i + 1 && kinds(r) == both).map(|(_, r)| r).collect();
        let gap = b.staffs[0].0.min_y - a.staffs[a.staffs.len() - 1].0.max_y;
        if kinds(b).iter().all(|&g| g) && !alike.is_empty() && gap <= 1.25 * alike.iter().map(|r| inner_gap(r)).fold(f64::NEG_INFINITY, f64::max) {
            let mut staffs = a.staffs.clone();
            staffs.extend(b.staffs.iter().cloned());
            rows.splice(i..i + 2, [sorted_row(staffs)]);
        }
        i += 1;
    }
    rows
}

/// _runs_of_alike_rows
fn runs_of_alike_rows(rows: Vec<Row>) -> Vec<Vec<Row>> {
    let mut runs: Vec<Vec<Row>> = Vec::new();
    for row in rows {
        match runs.last_mut() {
            Some(run) if kinds(&run[0]) == kinds(&row) => run.push(row),
            _ => runs.push(vec![row]),
        }
    }
    runs
}

fn break_apart(row: &Row) -> Vec<Row> {
    row.staffs.iter().map(|s| Row { staffs: vec![s.clone()] }).collect()
}

/// _layout_runs: the page as runs of systems that share a layout.
fn layout_runs(rows: Vec<Row>) -> Vec<Vec<Row>> {
    let flat: Vec<bool> = rows.iter().flat_map(kinds).collect();
    let uniform = {
        let n = rows[0].staffs.len();
        rows.iter().all(|r| r.staffs.len() == n) && n > 1
    };
    let mut core = if uniform { None } else { find_periodic_core(&flat) };
    let grouped = rows.len() > 1 && rows.iter().any(|r| r.staffs.len() > 1);
    if matches!(core, Some((1, _, _))) && grouped {
        core = None;
    }
    if let (Some((_, front, back)), true) = (core, grouped) {
        let cuts = [front, flat.len() - back];
        let mut i = 0;
        for row in &rows {
            let n = row.staffs.len();
            if n > 1 && cuts.iter().any(|&c| i < c && c < i + n) {
                core = None;
                break;
            }
            i += n;
        }
    }
    if core.is_none() && grouped {
        let mut out = Vec::new();
        for piece in runs_of_alike_rows(rows) {
            if piece[0].staffs.len() == 1 {
                out.extend(layout_runs(piece));
            } else {
                out.push(piece);
            }
        }
        return out;
    }
    let (front, back) = match core {
        None => return vec![ensure_same_number_of_staffs(rows)],
        Some((_, f, b)) if f == b && b == 0 => return vec![ensure_same_number_of_staffs(rows)],
        Some((_, f, b)) => (f, b),
    };
    let cuts = [front, flat.len() - back];
    let piece_of = |k: usize| (k >= cuts[0]) as usize + (k >= cuts[1]) as usize;
    let mut pieces: [Vec<Row>; 3] = [vec![], vec![], vec![]];
    let mut i = 0;
    for row in rows {
        let n = row.staffs.len();
        let whole = piece_of(i) == piece_of(i + n - 1);
        for part in if whole { vec![row] } else { break_apart(&row) } {
            let m = part.staffs.len();
            pieces[piece_of(i)].push(part);
            i += m;
        }
    }
    pieces.into_iter().filter(|p| !p.is_empty()).flat_map(layout_runs).collect()
}

/// _bar_count
fn bar_count(symbols: &[Symbol]) -> usize {
    let (mut bars, mut open) = (0, false);
    for s in symbols {
        if s.rhythm.contains("barline") || s.rhythm.starts_with("repeat") {
            bars += 1;
            open = false;
        } else if is_note_or_rest(s) {
            open = true;
        }
    }
    bars + open as usize
}

/// homr's own parse_staffs (one layout on the page).
fn parse_staffs(rows: Vec<Row>, reader: &mut dyn Reader) -> Result<Vec<Vec<Symbol>>, Stop> {
    let rows = ensure_same_number_of_staffs(rows);
    let reg = regions(&rows);
    let mut voices = Vec::new();
    for voice in 0..rows[0].staffs.len() {
        let mut out: Vec<Symbol> = Vec::new();
        for row in &rows {
            let (staff, grand) = row.staffs.get(voice).ok_or_else(|| Stop::Error("IndexError: list index out of range".into()))?;
            let result = reader.read(staff, *grand, &reg)?;
            if result.is_empty() {
                continue;
            }
            out.extend(result);
            out.push(Symbol::new("newline"));
        }
        voices.push(remove_duplicated_symbols(&out));
    }
    Ok(voices)
}

/// The page's systems as parse_staffs_by_layout groups them, before any staff
/// is read (so without _split_false_grand_staffs, which reads grand staffs:
/// a grand staff counts as one, as when it's real). For checking the systems
/// before reading the whole score.
/// Also the parts it would give the page, in order: whether each is a grand staff.
pub fn layout_systems(rows: Vec<Row>, user_ranges: &[(f64, f64)], reader: &dyn Reader) -> (Vec<Row>, Vec<bool>) {
    let (rows, runs) = if !user_ranges.is_empty() {
        let rows = user_systems(rows, user_ranges, reader);
        let runs = runs_of_alike_rows(rows.clone());
        (rows, runs)
    } else {
        let rows = join_split_rows(rows);
        let runs = layout_runs(rows.clone());
        (rows, runs)
    };
    if runs.len() == 1 && user_ranges.is_empty() {
        let rows = ensure_same_number_of_staffs(rows);
        let parts = kinds(&rows[0]);
        return (rows, parts);
    }
    let order = part_order(&runs);
    (runs.into_iter().flatten().collect(), order.into_iter().map(|k| k.0).collect())
}

/// The parts runs of systems give, in order (as parse_staffs_by_layout keys them).
fn part_order(runs: &[Vec<Row>]) -> Vec<(bool, usize)> {
    let mut order: Vec<(bool, usize)> = Vec::new();
    for run in runs {
        let keys = run_keys(&run[0]);
        for (n, key) in keys.iter().enumerate() {
            if !order.contains(key) {
                let later = keys[n + 1..].iter().filter_map(|k| order.iter().position(|o| o == k)).min();
                order.insert(later.unwrap_or(order.len()), *key);
            }
        }
    }
    order
}

/// A system's staves as parts: (grand, which of that kind).
fn run_keys(row: &Row) -> Vec<(bool, usize)> {
    let mut seen: Vec<(bool, usize)> = Vec::new();
    let mut keys = Vec::new();
    for &(_, kind) in &row.staffs {
        let k = match seen.iter_mut().find(|s| s.0 == kind) {
            Some(s) => {
                s.1 += 1;
                s.1
            }
            None => {
                seen.push((kind, 0));
                0
            }
        };
        keys.push((kind, k));
    }
    keys
}

/// _parse_staffs_by_layout: read runs of alike systems, giving a part that's
/// missing from a run empty bars there.
pub fn parse_staffs_by_layout(rows: Vec<Row>, user_ranges: &[(f64, f64)], reader: &mut dyn Reader) -> Result<Vec<Vec<Symbol>>, Stop> {
    let rows = split_false_grand_staffs(rows, reader)?;
    let (rows, runs) = if !user_ranges.is_empty() {
        let rows = user_systems(rows, user_ranges, reader);
        let runs = runs_of_alike_rows(rows.clone());
        (rows, runs)
    } else {
        let rows = join_split_rows(rows);
        let runs = layout_runs(rows.clone());
        (rows, runs)
    };
    if runs.len() == 1 && user_ranges.is_empty() {
        return parse_staffs(rows, reader);
    }
    let all: Vec<Row> = runs.iter().flatten().cloned().collect();
    let reg = regions(&all);
    let mut parts: Vec<((bool, usize), Vec<Symbol>)> = Vec::new();
    let mut order: Vec<(bool, usize)> = Vec::new();
    let mut rows_read: Vec<usize> = Vec::new();
    for run in &runs {
        let keys = run_keys(&run[0]);
        for (n, key) in keys.iter().enumerate() {
            if !order.contains(key) {
                let later = keys[n + 1..].iter().filter_map(|k| order.iter().position(|o| o == k)).min();
                order.insert(later.unwrap_or(order.len()), *key);
            }
        }
        for row in run {
            let mut read: Vec<((bool, usize), Vec<Symbol>)> = Vec::new();
            for (key, (staff, grand)) in keys.iter().zip(&row.staffs) {
                let symbols = reader.read(staff, *grand, &reg)?;
                if !symbols.is_empty() {
                    read.push((*key, symbols));
                }
            }
            let bars = read.iter().map(|r| bar_count(&r.1)).max().unwrap_or(0);
            for key in &order {
                if !parts.iter().any(|p| p.0 == *key) {
                    let mut filler = Vec::new();
                    for &n in &rows_read {
                        filler.extend((0..n).map(|_| Symbol::new("barline")));
                        filler.push(Symbol::new("newline"));
                    }
                    parts.push((*key, filler));
                }
                let part = &mut parts.iter_mut().find(|p| p.0 == *key).unwrap().1;
                match read.iter().find(|r| r.0 == *key) {
                    Some(r) => part.extend(r.1.iter().cloned()),
                    None => part.extend((0..bars).map(|_| Symbol::new("barline"))),
                }
                part.push(Symbol::new("newline"));
            }
            rows_read.push(bars);
        }
    }
    Ok(order.iter().map(|k| remove_duplicated_symbols(&parts.iter().find(|p| p.0 == *k).unwrap().1)).collect())
}

fn same(a: &Symbol, b: &Symbol) -> bool {
    a.key() == b.key()
}

fn no_pitch(s: &str) -> bool {
    s == EMPTY || s == NONOTE
}

/// _apply_key
fn apply_key(symbols: &mut [Symbol], start: usize, end: usize, key: &str) {
    let fifths: i64 = key.split('_').nth(1).and_then(|v| v.parse().ok()).unwrap_or(0);
    let steps: &str = if fifths > 0 { &"FCGDAEB"[..fifths.min(7) as usize] } else { &"BEADGCF"[..(-fifths).min(7) as usize] };
    for s in symbols[start..end].iter_mut() {
        if s.rhythm.starts_with("keySignature") {
            break;
        }
        let first: String = s.pitch.chars().take(1).collect();
        if s.rhythm.starts_with("note") && no_pitch(&s.lift) && steps.contains(first.as_str()) {
            s.lift = if fifths > 0 { "#".into() } else { "b".into() };
        }
    }
}

/// _drop_false_key_changes: a key change partway along a line that the next
/// line takes back was a misread time signature.
pub fn drop_false_key_changes(symbols: Vec<Symbol>) -> Vec<Symbol> {
    let mut rows: Vec<Vec<Symbol>> = Vec::new();
    let mut row = Vec::new();
    for s in symbols {
        let nl = s.rhythm == "newline";
        row.push(s);
        if nl {
            rows.push(std::mem::take(&mut row));
        }
    }
    rows.push(row);
    let header_key = |r: &[Symbol]| -> Option<String> {
        for s in r {
            if is_note_or_rest(s) || s.rhythm.contains("barline") {
                return None;
            }
            if s.rhythm.starts_with("keySignature") {
                return Some(s.rhythm.clone());
            }
        }
        None
    };
    let mut key: Option<String> = None;
    for n in 0..rows.len() {
        if let Some(k) = header_key(&rows[n]) {
            key = Some(k);
        }
        let mut in_header = true;
        let snapshot = rows[n].clone();
        for s in &snapshot {
            if is_note_or_rest(s) || s.rhythm.contains("barline") {
                in_header = false;
            } else if s.rhythm.starts_with("keySignature") && !in_header && Some(&s.rhythm) != key.as_ref() {
                let r = &rows[n];
                let at = r.iter().position(|x| same(x, s)).unwrap();
                let later = r[at + 1..].iter().any(|x| x.rhythm.starts_with("keySignature"));
                let next_back = n + 1 < rows.len() && header_key(&rows[n + 1]) == key;
                if let (Some(k), false, true) = (key.clone(), later, next_back) {
                    let r = &mut rows[n];
                    r.remove(at);
                    let len = r.len();
                    apply_key(r, at, len, &k);
                    continue;
                }
                key = Some(s.rhythm.clone());
            }
        }
    }
    rows.into_iter().flatten().collect()
}
