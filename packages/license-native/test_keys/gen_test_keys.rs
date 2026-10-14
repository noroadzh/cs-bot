use ed25519_dalek::Signer;
use rand::thread_rng;
use std::fs::File;
use std::io::Write;

fn main() {
    let mut rng = thread_rng();
    let signing_key = ed25519_dalek::SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();
    
    // Write signing key (PEM format)
    let mut sk_file = File::create("test_signing_key").unwrap();
    sk_file.write_all(&signing_key.to_bytes()).unwrap();
    
    // Write verifying key (32 bytes raw)
    let mut pk_file = File::create("test_pubkey.bin").unwrap();
    pk_file.write_all(verifying_key.as_bytes()).unwrap();
    
    println!("Keys generated");
    println!("Signing key bytes: {:?}", &signing_key.to_bytes()[..8]);
    println!("Verifying key hex: {}", hex::encode(verifying_key.as_bytes()));
}
