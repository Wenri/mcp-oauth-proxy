import approvalCssContent from "./approval.css";
import { getFileContent as getMcpFileContent } from "../../mcp-backend/static";

export const getApprovalCss = () => approvalCssContent;

const staticFiles: Record<string, { content: () => string; mimeType: string }> = {
	"approval.css": { content: getApprovalCss, mimeType: "text/css; charset=utf-8" },
};

export async function getFileContent(name: string): Promise<{ content: string; mimeType: string } | null> {
	const entry = staticFiles[name];
	if (entry) {
		return { content: entry.content(), mimeType: entry.mimeType };
	}
	// Fall back to mcp-backend static files (docs served as markdown)
	const mcpContent = await getMcpFileContent(name);
	if (mcpContent !== null) {
		return { content: mcpContent, mimeType: "text/markdown; charset=utf-8" };
	}
	return null;
}
