/** Add an explicit recovery action only to unavailable mobile file previews. */
export function installFilePreviewRecovery(doc: Document, reload: () => void): () => void {
  const owned = new Set<HTMLElement>()
  const scan = (): void => {
    if (!doc.defaultView?.matchMedia('(max-width: 768px)').matches) return
    for (const preview of doc.querySelectorAll<HTMLElement>('[data-textpreview-state="loading"]')) {
      // The native unavailable branch renders a paragraph; genuine loading renders a spinner.
      if (!preview.querySelector(':scope > p') || preview.querySelector('[data-mobile-file-recovery]')) continue
      const box = doc.createElement('div')
      box.dataset.mobileFileRecovery = ''
      const text = doc.createElement('p')
      text.textContent = '文件预览服务尚未连接。可重新载入页面恢复服务；这不会放宽文件访问权限。'
      const button = doc.createElement('button')
      button.type = 'button'
      button.textContent = '重新载入文件预览'
      button.addEventListener('click', reload)
      box.append(text, button)
      preview.append(box)
      owned.add(box)
    }
  }
  const observer = new MutationObserver(scan)
  observer.observe(doc.body, { childList: true, subtree: true })
  scan()
  return () => {
    observer.disconnect()
    for (const box of owned) box.remove()
    owned.clear()
  }
}
