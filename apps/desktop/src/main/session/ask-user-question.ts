// 负责 Claude 的 AskUserQuestion 工具输入和回答的格式：从工具输入读出问题，
// 把用户的回答写成 Claude 要的「问题原文 → 选中的选项」。

/** 一个问题；选项只留有文字的。 */
export type SessionQuestion = {
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}

/** 从 AskUserQuestion 的工具输入读出问题；没有问题或任何一个问题没有原文时返回 null。 */
export function parseQuestions(input: Record<string, unknown>): SessionQuestion[] | null {
  const list = input.questions
  if (!Array.isArray(list) || list.length === 0) return null
  const questions: SessionQuestion[] = []
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.question !== "string" || entry.question.trim() === "") {
      return null
    }
    questions.push({
      question: entry.question,
      ...(typeof entry.header === "string" && entry.header !== "" ? { header: entry.header } : {}),
      options: Array.isArray(entry.options) ? entry.options.flatMap(readOption) : [],
      multiSelect: entry.multiSelect === true,
    })
  }
  return questions
}

/**
 * 回答记录：问题原文 → 答案。answers 与问题顺序一致，多选在界面上已用逗号连接；
 * 空白的答案不写入。
 */
export function answerRecord(
  questions: readonly SessionQuestion[],
  answers: readonly string[],
): Record<string, string> {
  const record: Record<string, string> = {}
  questions.forEach((question, index) => {
    const answer = answers[index]?.trim()
    if (answer) record[question.question] = answer
  })
  return record
}

function readOption(value: unknown): SessionQuestion["options"] {
  if (!isRecord(value) || typeof value.label !== "string" || value.label.trim() === "") return []
  return [
    {
      label: value.label,
      ...(typeof value.description === "string" && value.description !== ""
        ? { description: value.description }
        : {}),
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
