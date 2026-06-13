// The slash menu. Built on @tiptap/suggestion (trigger `/`), rendered as a
// floating React menu positioned at the caret — no tippy/floating-ui dep, just
// a fixed-position element we place from the suggestion's clientRect. Each item
// runs an editor command; the list filters as you type. Sub-page and voice
// delegate to callbacks supplied by PageEditor (they own the picker + mic).

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { ReactNode } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import {
  IconText,
  IconHeading,
  IconList,
  IconListNumbered,
  IconTodo,
  IconDivider,
  IconQuote,
  IconImage,
  IconPage,
  IconSpark,
  IconMic,
} from '../../components/Icons'

export interface SlashCommandOptions {
  /** Open the sub-page picker; insertion point `at` is where the slash was. */
  onPickSubPage?: (editor: Editor, at: number) => void
  /** Start the mic/voice flow; text is inserted at the cursor on transcription. */
  onVoice?: (editor: Editor) => void
}

interface SlashItem {
  id: string
  title: string
  subtitle: string
  icon: ReactNode
  keywords: string[]
  run: (ctx: { editor: Editor; range: Range }) => void
}

function buildItems(options: SlashCommandOptions): SlashItem[] {
  return [
    {
      id: 'text',
      title: 'Text',
      subtitle: 'Plain paragraph',
      icon: <IconText />,
      keywords: ['paragraph', 'p', 'body', 'plain'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      id: 'h1',
      title: 'Heading 1',
      subtitle: 'Big section title',
      icon: <IconHeading />,
      keywords: ['h1', 'title', 'heading', 'large'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      title: 'Heading 2',
      subtitle: 'Medium heading',
      icon: <IconHeading />,
      keywords: ['h2', 'heading', 'subtitle'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      title: 'Heading 3',
      subtitle: 'Small heading',
      icon: <IconHeading />,
      keywords: ['h3', 'heading', 'minor'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
    },
    {
      id: 'bullet',
      title: 'Bulleted list',
      subtitle: 'A simple bullet list',
      icon: <IconList />,
      keywords: ['bullet', 'unordered', 'list', 'ul'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      id: 'ordered',
      title: 'Numbered list',
      subtitle: 'A list with ordering',
      icon: <IconListNumbered />,
      keywords: ['numbered', 'ordered', 'list', 'ol', '1'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      id: 'todo',
      title: 'To-do list',
      subtitle: 'Track tasks with checkboxes',
      icon: <IconTodo />,
      keywords: ['todo', 'task', 'checkbox', 'check'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: 'divider',
      title: 'Divider',
      subtitle: 'A horizontal rule',
      icon: <IconDivider />,
      keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      id: 'quote',
      title: 'Quote',
      subtitle: 'Capture a quotation',
      icon: <IconQuote />,
      keywords: ['quote', 'blockquote', 'citation'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      id: 'image',
      title: 'Image',
      subtitle: 'Embed an image by URL',
      icon: <IconImage />,
      keywords: ['image', 'img', 'picture', 'photo'],
      run: ({ editor, range }) => {
        const url = window.prompt('Image URL')?.trim()
        const chain = editor.chain().focus().deleteRange(range)
        if (url) chain.setImage({ src: url }).run()
        else chain.run()
      },
    },
    {
      id: 'subpage',
      title: 'Sub-page link',
      subtitle: 'Link or create a page',
      icon: <IconPage />,
      keywords: ['page', 'subpage', 'link', 'mention'],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        options.onPickSubPage?.(editor, range.from)
      },
    },
    {
      id: 'ai',
      title: 'Ask AI',
      subtitle: 'Answer grounded in your vault',
      icon: <IconSpark />,
      keywords: ['ai', 'ask', 'assistant', 'claude', 'gpt'],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertContent({ type: 'aiBlock' }).run(),
    },
    {
      id: 'voice',
      title: 'Voice',
      subtitle: 'Dictate with your mic',
      icon: <IconMic />,
      keywords: ['voice', 'mic', 'dictate', 'transcribe', 'speak'],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        options.onVoice?.(editor)
      },
    },
  ]
}

// ——— the floating menu component ———

interface SlashMenuProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
}
interface SlashMenuRef {
  onKeyDown: (e: KeyboardEvent) => boolean
}

const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>((props, ref) => {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [props.items])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (e) => {
        const n = props.items.length
        if (n === 0) return false
        if (e.key === 'ArrowDown') {
          setActive((a) => (a + 1) % n)
          return true
        }
        if (e.key === 'ArrowUp') {
          setActive((a) => (a - 1 + n) % n)
          return true
        }
        if (e.key === 'Enter') {
          const it = props.items[active]
          if (it) props.command(it)
          return true
        }
        return false
      },
    }),
    [props, active],
  )

  if (props.items.length === 0) {
    return <div className="slash-menu slash-menu-empty">No blocks match</div>
  }
  return (
    <div className="slash-menu" role="listbox">
      {props.items.map((it, i) => (
        <button
          key={it.id}
          className="slash-item"
          role="option"
          aria-selected={i === active}
          data-active={i === active}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.command(it)}
        >
          <span className="slash-icon">{it.icon}</span>
          <span className="slash-text">
            <span className="slash-title">{it.title}</span>
            <span className="slash-sub">{it.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  )
})
SlashMenu.displayName = 'SlashMenu'

function place(el: HTMLElement, clientRect?: (() => DOMRect | null) | null): void {
  const rect = clientRect?.()
  if (!rect) return
  el.style.position = 'fixed'
  el.style.zIndex = '1500'
  const h = el.offsetHeight || 300
  const below = rect.bottom + 8
  const flipUp = below + h > window.innerHeight - 12
  el.style.top = `${flipUp ? Math.max(12, rect.top - h - 8) : below}px`
  el.style.left = `${Math.min(rect.left, window.innerWidth - 296)}px`
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { onPickSubPage: undefined, onVoice: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => {
          const q = query.toLowerCase().trim()
          const items = buildItems(options)
          if (!q) return items
          return items.filter(
            (it) =>
              it.title.toLowerCase().includes(q) ||
              it.keywords.some((k) => k.includes(q)),
          )
        },
        command: ({ editor, range, props }) => props.run({ editor, range }),
        render: () => {
          let renderer: ReactRenderer<SlashMenuRef, SlashMenuProps> | null = null
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer = new ReactRenderer<SlashMenuRef, SlashMenuProps>(SlashMenu, {
                editor: props.editor,
                props: {
                  items: props.items,
                  command: (it: SlashItem) => props.command(it),
                },
              })
              document.body.appendChild(renderer.element)
              place(renderer.element, props.clientRect)
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer?.updateProps({
                items: props.items,
                command: (it: SlashItem) => props.command(it),
              })
              if (renderer) place(renderer.element, props.clientRect)
            },
            onKeyDown: (props: SuggestionKeyDownProps) =>
              renderer?.ref?.onKeyDown(props.event) ?? false,
            onExit: () => {
              renderer?.element.remove()
              renderer?.destroy()
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
