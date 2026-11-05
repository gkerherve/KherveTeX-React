// Tools ▸ Connect to Claude… (MainWindow._show_mcp_dialog). The bridge
// itself and its start-up live in src/mcp/.
import { registerActions } from '../actions'

registerActions({
  connect_claude: async () => {
    const { showMcpDialog } = await import('../../mcp/McpDialog')
    showMcpDialog()
  },
})
