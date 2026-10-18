// 负责提供浏览器和 Node 构建配置均可读取的首帧主题脚本。
/** 提供不依赖 React 的无注释脚本，供应用在首帧绘制前恢复主题。 */
export const themeInitializationScript =
  'try{if(localStorage.getItem("pigclaude-theme")==="light"){document.documentElement.dataset.theme="light"}else{delete document.documentElement.dataset.theme}}catch{}'
