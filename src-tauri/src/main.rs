// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `KherveTeX --mcp-server`: the stdio MCP server Claude Desktop / Claude
    // Code launch. It relays to the running app's bridge and never opens a
    // window (khervedoc/mcp_server.py, kherveDOC.py's --mcp-server).
    if std::env::args().skip(1).any(|a| a == "--mcp-server") {
        std::process::exit(khervetex_lib::mcp_server::main());
    }
    khervetex_lib::run();
}
