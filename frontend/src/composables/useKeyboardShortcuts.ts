import { ref, onMounted, onUnmounted } from 'vue'

export interface ShortcutItem {
  key: string
  label: string
  handler: () => void
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
}

export function useKeyboardShortcuts() {
  const shortcuts = ref<ShortcutItem[]>([])

  function register(shortcut: ShortcutItem) {
    shortcuts.value.push(shortcut)
  }

  function unregister(key: string) {
    shortcuts.value = shortcuts.value.filter(s => s.key !== key)
  }

  function clear() {
    shortcuts.value = []
  }

  function handleKeydown(e: KeyboardEvent) {
    for (const shortcut of shortcuts.value) {
      const mods = shortcut.modifiers || {}
      const match =
        e.key.toLowerCase() === shortcut.key.toLowerCase() &&
        (mods.ctrl === undefined || (mods.ctrl && (e.ctrlKey || e.metaKey))) &&
        (mods.meta === undefined || (mods.meta && e.metaKey)) &&
        (mods.shift === undefined || (mods.shift && e.shiftKey)) &&
        (mods.alt === undefined || (mods.alt && e.altKey))
      if (match) {
        e.preventDefault()
        shortcut.handler()
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return { register, unregister, clear, shortcuts }
}
