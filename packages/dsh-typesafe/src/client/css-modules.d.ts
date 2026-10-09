/**
 * CSS module 的环境声明。
 *
 * tsdown 的 dsh-css-modules-inline 插件把 `*.module.css` 编译成
 * 「已 hash 的类名映射 + 自动注入 <style>」的模块，默认导出就是那张
 * local → class 映射表；这里声明它的类型，让 tsc 认识 `import css from
 * './X.module.css'`（运行时由构建插件提供真实值）。
 *
 * @module @suxeca/dsh-typesafe/client/css-modules
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
