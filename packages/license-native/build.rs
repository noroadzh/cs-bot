// build.rs - N-API 构建配置

fn main() {
    // N-API 构建配置
    // 不需要生成测试密钥（已硬编码在源代码中）
    println!("cargo:rerun-if-changed=build.rs");
}