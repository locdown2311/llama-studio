// Embute o ícone e os dados de versão no .exe do Windows.
fn main() {
    println!("cargo:rerun-if-changed=assets/icon.ico");
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let mut res = winresource::WindowsResource::new();
    res.set_icon("assets/icon.ico")
        .set("ProductName", "Llama Studio")
        .set("FileDescription", "Llama Studio")
        .set("CompanyName", "locdown2311")
        .set("LegalCopyright", "MIT");
    if let Err(e) = res.compile() {
        // sem compilador de recursos (ex.: compilação cruzada): segue sem ícone no .exe
        println!("cargo:warning=ícone não embutido: {e}");
    }
}
