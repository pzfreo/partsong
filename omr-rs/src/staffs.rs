//! homr's page analysis (homr_rs::page::analyse_page), with one Partsong rule
//! between finding the staffs and pairing them into systems.

use homr_rs::braces::{multi_staffs, MultiStaff};
use homr_rs::geom::{RBox, NO_FRAGMENT};
use homr_rs::page::PageMasks;
use homr_rs::staff::{detect_staff, Fragments, Staff, StaffPoint};
use homr_rs::symbols::{page_symbols, Masks};

pub fn analyse_page(m: &PageMasks) -> Result<Vec<MultiStaff>, String> {
    let s = page_symbols(&Masks { h: m.h, w: m.w, notehead: m.notehead, staff: m.staff, clefs_keys: m.clefs_keys, stem_rests: m.stem_rests })?;
    let boxes: Vec<RBox> = s.fragments.iter().enumerate().map(|(i, f)| f.to_rbox(i)).collect();
    let contours: Vec<Vec<[i32; 2]>> = s.fragments.iter().map(|f| f.contour.clone()).collect();
    let clefs: Vec<RBox> = s.clefs_keys.iter().map(|c| c.to_rbox(NO_FRAGMENT)).collect();
    let bars: Vec<RBox> = s.bar_lines.iter().map(|c| c.to_rbox(NO_FRAGMENT)).collect();
    let staffs = detect_staff(m.staff, Some(m.symbols), m.h, m.w, &Fragments { boxes: &boxes, contours: &contours }, &clefs, &bars)?;
    if staffs.is_empty() {
        return Err("No staffs found".into());
    }
    multi_staffs(&extend_to_clefs(staffs, &clefs), m.symbols, m.staff, m.h, m.w)
}

/// A staff whose lines fade out before its clef (a faint photocopy) starts
/// after the gap: carry it on, straight, back to a clef or key signature on its
/// lines to the left, so the bar there is read too.
pub fn extend_to_clefs(staffs: Vec<Staff>, clefs: &[RBox]) -> Vec<Staff> {
    let others: Vec<(f64, f64, f64, f64)> = staffs.iter().map(|s| (s.min_x, s.max_x, s.min_y, s.max_y)).collect();
    staffs
        .into_iter()
        .enumerate()
        .map(|(si, st)| {
            let g = &st.grid;
            if g.len() < 2 {
                return st;
            }
            let first = &g[0];
            let k = &g[(g.len() - 1).min(10)];
            let slope: Vec<f64> = first.y.iter().zip(&k.y).map(|(a, b)| (b - a) / (k.x - first.x)).collect();
            let unit = (first.y[first.y.len() - 1] - first.y[0]) / (first.y.len() - 1) as f64;
            let at = |x: f64, i: usize| first.y[i] + slope[i] * (x - first.x);
            let top = first.y.len() - 1;
            let start = clefs
                .iter()
                .filter(|c| {
                    c.cx < first.x
                        && first.x - c.right_x() <= 25.0 * unit
                        && c.cy >= at(c.cx, 0) - unit
                        && c.cy <= at(c.cx, top) + unit
                        // nothing else on these lines in between
                        && !others.iter().enumerate().any(|(oi, o)| {
                            oi != si && o.1 > c.cx && o.0 < first.x && o.2 < at(c.cx, top) && o.3 > at(c.cx, 0)
                        })
                })
                .map(|c| c.left_x() - 2.0 * unit)
                .fold(f64::INFINITY, f64::min);
            if !start.is_finite() {
                return st;
            }
            let mut grid = Vec::new();
            let mut x = first.x - 10.0;
            while x >= start {
                grid.push(StaffPoint { x, y: (0..=top).map(|i| at(x, i)).collect(), angle: first.angle });
                x -= 10.0;
            }
            grid.reverse();
            grid.extend(g.iter().cloned());
            Staff::from_grid(grid).unwrap_or(st)
        })
        .collect()
}
