// 负责输入区提交结果处理：只有提交成功才清空编辑器，失败或被拒绝时保留草稿。

/** 提交文本；保证 submit 返回 true 后才调用 clear，返回 false 或抛错时草稿保持不变。 */
export async function submitComposerText(
  text: string,
  submit: (text: string) => boolean | Promise<boolean>,
  clear: () => void,
): Promise<boolean> {
  if (text.trim() === "") return false
  const submitted = await submit(text)
  if (submitted) clear()
  return submitted
}
