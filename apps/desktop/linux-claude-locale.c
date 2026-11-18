/* 在 Linux 原生 Claude CLI 初始化 JavaScriptCore 前应用当前会话的字符分类语言。 */

#define _POSIX_C_SOURCE 200809L
#include <locale.h>
#include <stdio.h>
#include <stdlib.h>

__attribute__((constructor))
static void initialize_claude_locale(void)
{
    unsetenv("LD_PRELOAD");
    if (setlocale(LC_CTYPE, "") == NULL) {
        fputs("PigClaude: Claude Code locale is unavailable on this system\n", stderr);
        _Exit(78);
    }
}
