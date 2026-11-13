//! The LEFI root CA that Lefi Crop Helper creates at activation (INSTALLER.md §10.1) signs the main
//! PC's server certificate and one client certificate per satellite. Its private key never
//! leaves the main PC.

use std::net::IpAddr;
use std::path::Path;

use rcgen::{
    BasicConstraints, CertificateParams, CertificateSigningRequestParams, DistinguishedName,
    DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType,
};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// Lifetimes until OD-7 (rotation and renewal) is decided.
pub const NODE_CERT_DAYS: i64 = 730;
pub const SERVER_CERT_DAYS: i64 = 397;
/// Lefi Brain's issuing CA (ADR-048): five years, may sign only end-entity certificates.
pub const BRAIN_ISSUING_CA_DAYS: i64 = 5 * 365;

pub struct RootCa {
    pub cert_pem: String,
    pub fingerprint: String,
    issuer: rcgen::Certificate,
    key: KeyPair,
}

pub fn der_from_pem(pem: &str) -> Result<Vec<u8>> {
    let mut rd = pem.as_bytes();
    let first = rustls_pemfile::certs(&mut rd).next();
    first
        .and_then(|c| c.ok())
        .map(|c| c.to_vec())
        .ok_or_else(|| Error::new("CERT_INVALID", "not a PEM certificate"))
}

/// SHA-256 of the certificate DER, lowercase hex — what a join command pins.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn validity(params: &mut CertificateParams, days: i64) {
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::hours(1);
    params.not_after = now + time::Duration::days(days);
}

impl RootCa {
    /// Loads `<data>/ca/root-ca.pem` + `root-ca.key.pem` (written by Lefi Crop Helper).
    pub fn load(data_dir: &Path) -> Result<Self> {
        let dir = data_dir.join("ca");
        let cert_pem = std::fs::read_to_string(dir.join("root-ca.pem")).map_err(|_| {
            Error::new(
                "NOT_ACTIVATED",
                "No LEFI root CA here: activate this PC in Lefi Crop Helper first",
            )
        })?;
        let key_pem = std::fs::read_to_string(dir.join("root-ca.key.pem"))
            .map_err(|e| Error::new("CA_KEY", format!("Cannot read the root CA key: {e}")))?;
        Self::from_pem(&cert_pem, &key_pem)
    }

    pub fn from_pem(cert_pem: &str, key_pem: &str) -> Result<Self> {
        let key = KeyPair::from_pem(key_pem).map_err(|e| Error::new("CA_KEY", e.to_string()))?;
        // Rebuild an issuer with the same name and key: certificates it signs chain to the
        // original root (rcgen cannot sign with a parsed certificate directly).
        let params = CertificateParams::from_ca_cert_pem(cert_pem)
            .map_err(|e| Error::new("CA_INVALID", e.to_string()))?;
        let issuer = params
            .self_signed(&key)
            .map_err(|e| Error::new("CA_INVALID", e.to_string()))?;
        let fingerprint = fingerprint(&der_from_pem(cert_pem)?);
        Ok(Self {
            cert_pem: cert_pem.to_string(),
            fingerprint,
            issuer,
            key,
        })
    }

    /// TLS server certificate for the main PC's addresses (satellites connect by IP).
    pub fn server_cert(&self, ips: &[IpAddr]) -> Result<(String, String)> {
        let mut p = CertificateParams::new(vec!["localhost".to_string()])
            .map_err(|e| Error::new("CERT_ISSUE", e.to_string()))?;
        for ip in ips {
            p.subject_alt_names.push(SanType::IpAddress(*ip));
        }
        p.distinguished_name
            .push(DnType::CommonName, "Lefi Crop Helper main PC");
        p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        p.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        validity(&mut p, SERVER_CERT_DAYS);
        let k = KeyPair::generate().map_err(|e| Error::new("CERT_ISSUE", e.to_string()))?;
        let c = p
            .signed_by(&k, &self.issuer, &self.key)
            .map_err(|e| Error::new("CERT_ISSUE", e.to_string()))?;
        Ok((c.pem(), k.serialize_pem()))
    }

    /// Signs a satellite's CSR. Only its public key is taken from the request: the name, usages
    /// and lifetime are set here, so a satellite cannot ask for a CA or a server certificate.
    pub fn sign_node_csr(&self, csr_pem: &str, node_id: &str) -> Result<String> {
        let mut csr = CertificateSigningRequestParams::from_pem(csr_pem).map_err(|e| {
            Error::new(
                "CSR_INVALID",
                format!("The certificate request is not valid: {e}"),
            )
        })?;
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, node_id);
        dn.push(DnType::OrganizationName, "Lefi Crop satellite");
        csr.params.distinguished_name = dn;
        csr.params.subject_alt_names = vec![];
        csr.params.is_ca = IsCa::ExplicitNoCa;
        csr.params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        csr.params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        csr.params.custom_extensions = vec![];
        validity(&mut csr.params, NODE_CERT_DAYS);
        let cert = csr
            .signed_by(&self.issuer, &self.key)
            .map_err(|e| Error::new("CERT_ISSUE", e.to_string()))?;
        Ok(cert.pem())
    }
}

impl RootCa {
    /// Signs Lefi Brain's issuing-CA request (ADR-026 two-level CA, ADR-048). Only the key is taken
    /// from the request: the certificate is a CA with path length 0, so what Lefi Brain signs with it
    /// (Lefi Desktop device certificates) cannot sign anything else.
    pub fn sign_brain_issuing_csr(&self, csr_pem: &str) -> Result<String> {
        let mut csr = CertificateSigningRequestParams::from_pem(csr_pem).map_err(|e| {
            Error::new(
                "CSR_INVALID",
                format!("Lefi Brain's certificate request is not valid: {e}"),
            )
        })?;
        let mut dn = DistinguishedName::new();
        dn.push(DnType::OrganizationName, "Lefi Crop");
        dn.push(DnType::CommonName, "Lefi Brain issuing CA");
        csr.params.distinguished_name = dn;
        csr.params.subject_alt_names = vec![];
        csr.params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        csr.params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        csr.params.extended_key_usages = vec![];
        csr.params.custom_extensions = vec![];
        validity(&mut csr.params, BRAIN_ISSUING_CA_DAYS);
        let cert = csr
            .signed_by(&self.issuer, &self.key)
            .map_err(|e| Error::new("CERT_ISSUE", e.to_string()))?;
        Ok(cert.pem())
    }
}

/// A throwaway root CA for tests (the real one is created by Lefi Crop Helper).
pub fn test_root() -> (String, String) {
    let key = KeyPair::generate().expect("key");
    let mut p = CertificateParams::default();
    p.distinguished_name
        .push(DnType::CommonName, "TEST root CA");
    p.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    validity(&mut p, 30);
    let c = p.self_signed(&key).expect("root");
    (c.pem(), key.serialize_pem())
}

/// A satellite's key pair and CSR.
pub fn new_csr(hostname: &str) -> Result<(String, String)> {
    let key = KeyPair::generate().map_err(|e| Error::new("CSR_CREATE", e.to_string()))?;
    let mut p = CertificateParams::default();
    p.distinguished_name.push(DnType::CommonName, hostname);
    let csr = p
        .serialize_request(&key)
        .map_err(|e| Error::new("CSR_CREATE", e.to_string()))?;
    let pem = csr
        .pem()
        .map_err(|e| Error::new("CSR_CREATE", e.to_string()))?;
    Ok((pem, key.serialize_pem()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brain_issuing_ca_may_sign_only_end_entities() {
        let (cpem, kpem) = test_root();
        let ca = RootCa::from_pem(&cpem, &kpem).unwrap();
        let (csr, _key) = new_csr("Lefi Brain issuing CA").unwrap();
        let cert = ca.sign_brain_issuing_csr(&csr).unwrap();
        let parsed = CertificateParams::from_ca_cert_pem(&cert).unwrap();
        assert!(matches!(
            parsed.is_ca,
            IsCa::Ca(BasicConstraints::Constrained(0))
        ));
        assert!(ca.sign_brain_issuing_csr("not a request").is_err());
    }

    #[test]
    fn node_certificate_is_a_client_cert_named_by_the_main_pc() {
        let (cpem, kpem) = test_root();
        let ca = RootCa::from_pem(&cpem, &kpem).unwrap();
        let (csr, _key) = new_csr("evil-asks-for-anything").unwrap();
        let cert = ca.sign_node_csr(&csr, "pc-abc123").unwrap();
        let der = der_from_pem(&cert).unwrap();
        let (_, parsed) = x509_parser_for_tests::parse(&der);
        assert!(parsed.contains("pc-abc123"));
        assert!(!parsed.contains("evil-asks-for-anything"));
        assert_eq!(ca.fingerprint.len(), 64);
    }

    #[test]
    fn garbage_csr_is_refused() {
        let (cpem, kpem) = test_root();
        let ca = RootCa::from_pem(&cpem, &kpem).unwrap();
        assert_eq!(
            ca.sign_node_csr("hello", "pc-1").unwrap_err().code,
            "CSR_INVALID"
        );
    }

    /// Reads the subject via rcgen's own parser (no extra dependency).
    mod x509_parser_for_tests {
        pub fn parse(der: &[u8]) -> ((), String) {
            let pem = format!(
                "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
                base64_std(der)
            );
            let p = rcgen::CertificateParams::from_ca_cert_pem(&pem).expect("parse");
            ((), format!("{:?}", p.distinguished_name))
        }
        fn base64_std(data: &[u8]) -> String {
            const T: &[u8; 64] =
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut out = String::new();
            for chunk in data.chunks(3) {
                let b = [
                    chunk[0],
                    *chunk.get(1).unwrap_or(&0),
                    *chunk.get(2).unwrap_or(&0),
                ];
                let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
                for i in 0..4 {
                    if i <= chunk.len() {
                        out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
                    } else {
                        out.push('=');
                    }
                }
            }
            out
        }
    }
}
