import approvalCssContent from "./approval.css";

export const getApprovalCss = () => approvalCssContent;

const staticFiles: Record<string, { content: () => string; mimeType: string }> = {
	"approval-css": { content: getApprovalCss, mimeType: "text/css; charset=utf-8" },
};

export async function getFileContent(name: string): Promise<{ content: string; mimeType: string } | null> {
	const entry = staticFiles[name];
	return entry ? { content: entry.content(), mimeType: entry.mimeType } : null;
}
