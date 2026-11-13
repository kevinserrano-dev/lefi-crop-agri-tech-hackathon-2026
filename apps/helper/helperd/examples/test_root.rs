//! Development only: writes a throwaway root CA (as Lefi Crop Helper would) into DIR/ca/.
fn main() {
    let dir = std::path::PathBuf::from(std::env::args().nth(1).expect("usage: test_root DIR"));
    let (cert, key) = lefi_helperd::ca::test_root();
    std::fs::create_dir_all(dir.join("ca")).unwrap();
    std::fs::write(dir.join("ca/root-ca.pem"), cert).unwrap();
    std::fs::write(dir.join("ca/root-ca.key.pem"), key).unwrap();
}
