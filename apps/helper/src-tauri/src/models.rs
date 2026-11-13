//! Owner-approved models (`config/supported-models.tsv`, ADR-019 / ADR-028). Read, never invented.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SupportedModel {
    pub tag: String,
    pub label: String,
    /// `default` or `fallback`.
    pub role: String,
    /// Measured memory of the loaded model; `None` when the table says `?` (not measured).
    pub mem_gb: Option<f64>,
    pub ctx: Option<u32>,
    pub measured_on: Option<String>,
}

fn measured(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|v| !v.is_empty() && *v != "?")
}

/// Columns: tag provider label role mem_gb ctx measured_on notes. Comment lines start with `#`.
pub fn parse(tsv: &str) -> Vec<SupportedModel> {
    tsv.lines()
        .filter(|l| !l.trim_start().starts_with('#') && !l.trim().is_empty())
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('\t').collect();
            let tag = cols.first()?.trim();
            if tag.is_empty() {
                return None;
            }
            Some(SupportedModel {
                tag: tag.to_string(),
                label: cols
                    .get(2)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default(),
                role: cols
                    .get(3)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default(),
                mem_gb: measured(cols.get(4).copied()).and_then(|v| v.parse().ok()),
                ctx: measured(cols.get(5).copied()).and_then(|v| v.parse().ok()),
                measured_on: measured(cols.get(6).copied()).map(str::to_string),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TSV: &str = "# tag\tprovider\tlabel\trole\tmem_gb\tctx\tmeasured_on\tnotes\n\
        fake:big\tAcme\tFake Big\tdefault\t7.4\t4096\tTest rig, 2026-01-01\tnote\n\
        fake:small\tAcme\tFake Small\tfallback\t?\t?\t?\tnot measured\n";

    #[test]
    fn parses_measured_and_unmeasured_rows() {
        let models = parse(TSV);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].tag, "fake:big");
        assert_eq!(models[0].mem_gb, Some(7.4));
        assert_eq!(models[0].ctx, Some(4096));
        assert_eq!(models[1].mem_gb, None);
        assert_eq!(models[1].measured_on, None);
        assert_eq!(models[1].role, "fallback");
    }

    #[test]
    fn repository_table_parses() {
        let tsv = include_str!("../../../../config/supported-models.tsv");
        assert!(!parse(tsv).is_empty());
    }
}
