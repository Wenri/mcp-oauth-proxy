import approvalCssContent from "./approval-css.txt";
import { staticFiles as mcpStaticFiles, dynamicFiles as mcpDynamicFiles } from "../../mcp-backend/static";

const localFiles: Record<string, { content: string; mimeType: string }> = {
	"approval.css": { content: approvalCssContent, mimeType: "text/css; charset=utf-8" },
};

export async function getFileContent(name: string): Promise<{ content: string; mimeType: string } | null> {
	const local = localFiles[name];
	if (local) return local;

	const staticContent = mcpStaticFiles[name];
	if (staticContent !== undefined) {
		return { content: staticContent, mimeType: "text/markdown; charset=utf-8" };
	}

	const dynamicFn = mcpDynamicFiles[name];
	if (dynamicFn) {
		return { content: await dynamicFn(), mimeType: "text/plain; charset=utf-8" };
	}

	return null;
}
