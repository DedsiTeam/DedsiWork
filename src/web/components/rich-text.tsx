import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  ImagePlus,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_IMAGE_SIZE,
  RICH_TEXT_PREFIX,
} from "../../shared/description";

export function descriptionContent(value: string) {
  if (value.startsWith(RICH_TEXT_PREFIX)) {
    const body = DOMPurify.sanitize(value.slice(RICH_TEXT_PREFIX.length), {
      RETURN_DOM: true,
      ALLOWED_TAGS: [
        "p",
        "br",
        "strong",
        "em",
        "s",
        "u",
        "h2",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "code",
        "hr",
        "img",
      ],
      ALLOWED_ATTR: ["src", "alt", "title"],
      FORBID_ATTR: ["style"],
    });
    if (!(body instanceof HTMLElement)) return "";
    for (const image of body.querySelectorAll("img")) {
      if (
        !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(
          image.getAttribute("src") || "",
        )
      )
        image.remove();
    }
    return body.innerHTML;
  }
  return {
    type: "doc",
    content: value.split("\n").map((text) => ({
      type: "paragraph",
      ...(text ? { content: [{ type: "text", text }] } : {}),
    })),
  };
}

export function RichText({
  value,
  disabled,
  onChange,
  onUploading,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onUploading: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const [initialContent] = useState(() => descriptionContent(value));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2] }, link: false }),
      Image.configure({ allowBase64: true }),
    ],
    content: initialContent,
    editable: !disabled,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "工作项描述",
        "aria-multiline": "true",
        id: "item-description",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (files.length) {
          event.preventDefault();
          void insertImages(files);
          return true;
        }
        // Pasted HTML is parsed by the schema; remove external images before parsing.
        const html = event.clipboardData?.getData("text/html");
        if (html) {
          event.preventDefault();
          editor?.commands.insertContent(
            descriptionContent(RICH_TEXT_PREFIX + html),
          );
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.isEmpty ? "" : RICH_TEXT_PREFIX + editor.getHTML();
      setError(
        next.length > MAX_DESCRIPTION_LENGTH
          ? "描述容量已超出，请删除部分图片或文字后保存。"
          : "",
      );
      onChange(next);
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled && !uploading);
  }, [editor, disabled, uploading]);
  async function insertImages(files: File[]) {
    if (!editor || disabled || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    onUploading(true);
    setError("");
    try {
      const images: string[] = [];
      for (const file of files) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type))
          throw new Error("请选择 PNG、JPEG、GIF 或 WebP 图片。");
        if (file.size > MAX_IMAGE_SIZE)
          throw new Error("每张图片不能超过 1 MB，请缩小后重试。");
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("图片读取失败"));
          reader.readAsDataURL(file);
        });
        await new Promise<void>((resolve, reject) => {
          const image = new window.Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("无法读取图片内容"));
          image.src = url;
        });
        images.push(url);
      }
      if (editor.isDestroyed) return;
      if (
        editor.getHTML().length +
          images.reduce((sum, url) => sum + url.length + 100, 0) +
          RICH_TEXT_PREFIX.length >
        MAX_DESCRIPTION_LENGTH
      )
        throw new Error("图片总容量过大，请减少图片或缩小后重试。");
      editor
        .chain()
        .focus()
        .insertContent(
          images.map((src) => ({
            type: "image",
            attrs: { src, alt: "工作项图片" },
          })),
        )
        .run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      uploadLock.current = false;
      setUploading(false);
      onUploading(false);
    }
  }
  if (!editor) return null;
  const actions = [
    {
      label: "加粗",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "标题",
      icon: Heading2,
      active: editor.isActive("heading"),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "无序列表",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "撤销",
      icon: Undo2,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "重做",
      icon: Redo2,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="rich-text">
      <div className="rich-toolbar" role="toolbar" aria-label="描述格式">
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            variant="ghost"
            size="icon-sm"
            title={action.label}
            aria-label={action.label}
            aria-pressed={action.active}
            disabled={disabled || uploading}
            onClick={action.run}
          >
            <action.icon size={16} />
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || uploading}
          onClick={() => input.current?.click()}
          title={uploading ? "读取中…" : "插入图片"}
          aria-label={uploading ? "读取中…" : "插入图片"}
        >
          <ImagePlus size={16} />
        </Button>
        <input
          ref={input}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(e) => {
            void insertImages(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </div>
      <EditorContent editor={editor} />
      <p className="rich-hint">
        支持粘贴或拖入图片 · 单张不超过 1 MB · 选中图片后按 Delete 删除
      </p>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
    </div>
  );
}
