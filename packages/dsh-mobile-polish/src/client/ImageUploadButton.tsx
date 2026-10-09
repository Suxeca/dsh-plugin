import { useRef } from 'react'
import css from './ImageUploadButton.module.css'

/**
 * Image attachment upload button for mobile / desktop web.
 * Triggers native image picker (camera/gallery/file picker) and dispatches files to composer.
 */
export function ImageUploadButton() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = (files: File[]): void => {
    if (files.length === 0) return
    try {
      const dt = new DataTransfer()
      for (const file of files) {
        dt.items.add(file)
      }
      const target = document.querySelector('[data-composer-card]') || document
      target.dispatchEvent(new DragEvent('drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }))
    } catch (err) {
      console.warn('[dsh-mobile-polish] Failed to dispatch image drop event:', err)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    handleFiles(files)
  }

  const onClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    inputRef.current?.click()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={onChange}
      />
      <button
        type="button"
        className={css.button}
        aria-label="添加图片附件"
        title="添加图片附件"
        onClick={onClick}
      >
        <svg
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="12" height="12" rx="2.5" />
          <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
          <path d="M14 10.5l-3.5-3.5L3 14" />
        </svg>
      </button>
    </>
  )
}
