export function htmlTransferParser(inputStr: string): string {
  if (inputStr == null || inputStr == '') return '';
  const transfer = ['&lt;', '&gt;', '&nbsp;', '&quot;', '&amp;'];
  const original = ['<', '>', ' ', '"', '&'];
  for (let i = 0; i < transfer.length; i++) {
    inputStr = inputStr.replace(new RegExp(transfer[i], 'g'), original[i]);
  }
  return inputStr;
}
