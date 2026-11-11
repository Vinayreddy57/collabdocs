
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  FileText,
  Plus,
  Upload,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Save,
  Share2,
  RefreshCw,
  Trash2
} from "lucide-react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const USERS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Bob"
  }
];

const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }]
};

export default function App() {
  const [user, setUser] = useState(USERS[0]);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sharePermission, setSharePermission] = useState("edit");

  const requestNumber = useRef(0);
  const activeDocRef = useRef(null);
  const userRef = useRef(user.id);

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: EMPTY_DOC,
    immediatelyRender: false,
    onUpdate: () => {
      setDirty(true);
      setStatus("Unsaved changes");
    }
  });

  const isOwner = Boolean(
    activeDoc && activeDoc.owner_id === user.id
  );

  const canEdit = Boolean(
    activeDoc &&
    (isOwner || activeDoc.permission === "edit")
  );

  function headers(userId = user.id) {
    return { "x-demo-user": userId };
  }

  function confirmDiscard() {
    return (
      !dirty ||
      window.confirm("Discard your unsaved changes?")
    );
  }

  function showError(err, fallback) {
    const message =
      err.response?.data?.error ||
      err.message ||
      fallback;
    setError(message);
    return message;
  }

  useEffect(() => {
    activeDocRef.current = activeDoc;
  }, [activeDoc]);

  useEffect(() => {
    userRef.current = user.id;
  }, [user.id]);

  useEffect(() => {
    editor?.setEditable(canEdit && !loading && !saving);
  }, [editor, canEdit, loading, saving]);

  useEffect(() => {
    if (!editor) return;

    const request = ++requestNumber.current;
    let cancelled = false;

    async function loadDocuments() {
      setLoading(true);
      setError("");

      try {
        const response = await axios.get(
          `${API}/documents`,
          { headers: headers(user.id) }
        );

        if (cancelled || request !== requestNumber.current) return;

        const docs = response.data;
        setDocuments(docs);

        if (docs.length === 0) {
          setActiveDoc(null);
          setTitle("");
          editor.commands.setContent(EMPTY_DOC, {
            emitUpdate: false
          });
        } else {
          const first = docs[0];

          const detail = await axios.get(
            `${API}/documents/${first.id}`,
            { headers: headers(user.id) }
          );

          if (cancelled || request !== requestNumber.current) return;

          setActiveDoc({ ...first, ...detail.data });
          setTitle(detail.data.title);

          editor.commands.setContent(
            detail.data.content || EMPTY_DOC,
            { emitUpdate: false }
          );
        }

        setDirty(false);
        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          showError(err, "Failed to load documents");
          setStatus("Load failed");
        }
      } finally {
        if (!cancelled && request === requestNumber.current) {
          setLoading(false);
        }
      }
    }

    loadDocuments();

    return () => {
      cancelled = true;
    };
  }, [user.id, editor]);

  async function refreshDocuments() {
    const response = await axios.get(
      `${API}/documents`,
      { headers: headers() }
    );
    setDocuments(response.data);
    return response.data;
  }

  async function openDocument(doc) {
    if (!confirmDiscard() || loading || saving) return;

    try {
      setLoading(true);
      setError("");

      const response = await axios.get(
        `${API}/documents/${doc.id}`,
        { headers: headers() }
      );

      setActiveDoc({ ...doc, ...response.data });
      setTitle(response.data.title);

      editor.commands.setContent(
        response.data.content || EMPTY_DOC,
        { emitUpdate: false }
      );

      setDirty(false);
      setStatus("Ready");
    } catch (err) {
      showError(err, "Unable to open document");
    } finally {
      setLoading(false);
    }
  }

  async function createDocument() {
    if (!confirmDiscard() || loading || saving) return;

    try {
      setLoading(true);
      setError("");

      const response = await axios.post(
        `${API}/documents`,
        {
          title: "Untitled Document",
          content: EMPTY_DOC
        },
        { headers: headers() }
      );

      const doc = response.data;
      setActiveDoc({
        ...doc,
        access_type: "owned",
        permission: "edit"
      });
      setTitle(doc.title);

      editor.commands.setContent(
        doc.content || EMPTY_DOC,
        { emitUpdate: false }
      );

      setDirty(false);
      setStatus("Document created");
      await refreshDocuments();
    } catch (err) {
      showError(err, "Unable to create document");
    } finally {
      setLoading(false);
    }
  }

  async function saveDocument() {
    if (!activeDoc || !editor || !canEdit || saving) return;

    const nextTitle = title.trim();

    if (!nextTitle) {
      setError("Document title cannot be empty");
      return;
    }

    const contentSnapshot = editor.getJSON();
    const documentId = activeDoc.id;

    try {
      setSaving(true);
      setError("");
      setStatus("Saving...");

      const response = await axios.patch(
        `${API}/documents/${documentId}`,
        {
          title: nextTitle,
          content: contentSnapshot
        },
        { headers: headers() }
      );

      setActiveDoc(previous =>
        previous?.id === documentId
          ? {
              ...previous,
              ...response.data,
              permission: previous.permission,
              access_type: previous.access_type
            }
          : previous
      );

      await refreshDocuments();
      setDirty(false);
      setStatus("Saved to database");
    } catch (err) {
      showError(err, "Unable to save document");
      setStatus("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function shareDocument() {
    if (!activeDoc || !isOwner || loading || saving) return;

    const recipient = USERS.find(u => u.id !== user.id);
    if (!recipient) return;

    try {
      setStatus("Sharing...");
      setError("");

      const response = await axios.post(
        `${API}/documents/${activeDoc.id}/share`,
        {
          userId: recipient.id,
          permission: sharePermission
        },
        { headers: headers() }
      );

      if (response.data.shared) {
        setStatus(
          `Shared with ${recipient.name} (${sharePermission})`
        );
        window.alert(
          `Document shared with ${recipient.name} (${sharePermission} access)!`
        );
      } else {
        throw new Error("Unexpected sharing response");
      }
    } catch (err) {
      showError(err, "Unable to share document");
      setStatus("Sharing failed");
    }
  }

  async function deleteDocument() {
    if (!activeDoc || !isOwner || loading || saving) return;

    if (!window.confirm(`Delete "${activeDoc.title}" permanently?`)) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      await axios.delete(
        `${API}/documents/${activeDoc.id}`,
        { headers: headers() }
      );

      const docs = await refreshDocuments();
      setActiveDoc(null);
      setTitle("");
      editor.commands.setContent(EMPTY_DOC, {
        emitUpdate: false
      });
      setDirty(false);

      if (docs.length > 0) {
        const detail = await axios.get(
          `${API}/documents/${docs[0].id}`,
          { headers: headers() }
        );

        setActiveDoc({ ...docs[0], ...detail.data });
        setTitle(detail.data.title);
        editor.commands.setContent(
          detail.data.content || EMPTY_DOC,
          { emitUpdate: false }
        );
      }

      setStatus("Document deleted");
    } catch (err) {
      showError(err, "Unable to delete document");
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) return;

    if (!/\.(txt|md)$/i.test(file.name)) {
      setError("Only .txt and .md files are supported");
      input.value = "";
      return;
    }

    if (file.size > 1024 * 1024) {
      setError("Maximum file size is 1 MB");
      input.value = "";
      return;
    }

    if (!confirmDiscard()) {
      input.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true);
      setStatus("Uploading...");
      setError("");

      const response = await axios.post(
        `${API}/upload`,
        formData,
        { headers: headers() }
      );

      const doc = response.data;

      setActiveDoc({
        ...doc,
        access_type: "owned",
        permission: "edit"
      });
      setTitle(doc.title);

      editor.commands.setContent(
        doc.content || EMPTY_DOC,
        { emitUpdate: false }
      );

      setDirty(false);
      setStatus("File imported successfully");

      await refreshDocuments();
    } catch (err) {
      showError(err, "Unable to upload file");
      setStatus("Upload failed");
    } finally {
      setLoading(false);
      input.value = "";
    }
  }

  function changeUser(userId) {
    if (loading || saving || !confirmDiscard()) return;

    const selected = USERS.find(u => u.id === userId);
    if (!selected) return;

    setActiveDoc(null);
    setDocuments([]);
    setDirty(false);
    setUser(selected);
  }

  const tools = [
    {
      icon: Bold,
      label: "Bold",
      active: editor?.isActive("bold"),
      action: () => editor.chain().focus().toggleBold().run()
    },
    {
      icon: Italic,
      label: "Italic",
      active: editor?.isActive("italic"),
      action: () => editor.chain().focus().toggleItalic().run()
    },
    {
      icon: UnderlineIcon,
      label: "Underline",
      active: editor?.isActive("underline"),
      action: () => editor.chain().focus().toggleUnderline().run()
    },
    {
      icon: Heading1,
      label: "Heading 1",
      active: editor?.isActive("heading", { level: 1 }),
      action: () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run()
    },
    {
      icon: Heading2,
      label: "Heading 2",
      active: editor?.isActive("heading", { level: 2 }),
      action: () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run()
    },
    {
      icon: List,
      label: "Bullet list",
      active: editor?.isActive("bulletList"),
      action: () =>
        editor.chain().focus().toggleBulletList().run()
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      active: editor?.isActive("orderedList"),
      action: () =>
        editor.chain().focus().toggleOrderedList().run()
    }
  ];

  return (
    <div className="workspace">
      <aside className="sidebar">
        <h2>
          <FileText size={24} />
          CollabDocs
        </h2>

        <label className="user-label" htmlFor="demo-user">
          DEMO USER
        </label>

        <select
          id="demo-user"
          className="user-select"
          value={user.id}
          onChange={e => changeUser(e.target.value)}
          disabled={loading || saving}
        >
          {USERS.map(u => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="new-button"
          onClick={createDocument}
          disabled={loading || saving}
        >
          <Plus size={18} />
          New Document
        </button>

        <label className="upload-button">
          <Upload size={18} />
          <span>Upload File</span>
          <input
            type="file"
            accept=".txt,.md"
            onChange={uploadDocument}
            disabled={loading || saving}
            hidden
          />
        </label>

        <p className="upload-hint">
          .txt and .md files only — max 1 MB
        </p>

        <h4>MY DOCUMENTS</h4>

        {documents
          .filter(doc => doc.access_type === "owned")
          .map(doc => (
            <button
              type="button"
              key={doc.id}
              className={`document-item ${
                activeDoc?.id === doc.id ? "selected" : ""
              }`}
              onClick={() => openDocument(doc)}
              disabled={loading || saving}
            >
              <FileText size={17} />
              <span>{doc.title}</span>
            </button>
          ))}

        <h4>SHARED WITH ME</h4>

        {documents
          .filter(doc => doc.access_type === "shared")
          .map(doc => (
            <button
              type="button"
              key={doc.id}
              className={`document-item ${
                activeDoc?.id === doc.id ? "selected" : ""
              }`}
              onClick={() => openDocument(doc)}
              disabled={loading || saving}
            >
              <FileText size={17} />
              <span>{doc.title}</span>
            </button>
          ))}
      </aside>

      <main className="main">
        <header className="topbar">
          <input
            className="title-input"
            value={title}
            disabled={!canEdit || loading || saving}
            onChange={e => {
              setTitle(e.target.value);
              setDirty(true);
              setStatus("Unsaved changes");
            }}
            placeholder="Document title"
            aria-label="Document title"
          />

          <div className="top-actions">
            <span className="save-status">{status}</span>

            {isOwner && (
              <>
                <select
                  aria-label="Sharing permission"
                  value={sharePermission}
                  onChange={e => setSharePermission(e.target.value)}
                  disabled={loading || saving}
                  className="user-select"
                  style={{ width: "auto", marginBottom: 0 }}
                >
                  <option value="edit">Can edit</option>
                  <option value="view">Can view</option>
                </select>

                <button
                  type="button"
                  className="share-button"
                  onClick={shareDocument}
                  disabled={loading || saving}
                >
                  <Share2 size={17} />
                  Share
                </button>

                <button
                  type="button"
                  className="share-button"
                  onClick={deleteDocument}
                  disabled={loading || saving}
                  title="Delete document"
                  aria-label="Delete document"
                >
                  <Trash2 size={17} />
                </button>
              </>
            )}

            <button
              type="button"
              className="save-button"
              onClick={saveDocument}
              disabled={!canEdit || saving || loading}
            >
              <Save size={17} />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="toolbar">
          {tools.map(({ icon: Icon, label, action, active }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              className={active ? "active" : ""}
              disabled={!editor || !canEdit || loading || saving}
              onMouseDown={e => e.preventDefault()}
              onClick={action}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>

        <div className="editor-background">
          {loading ? (
            <div className="loading">
              <RefreshCw size={20} />
              Loading...
            </div>
          ) : (
            <div className="paper">
              {activeDoc ? (
                <EditorContent editor={editor} />
              ) : (
                <p>
                  Click New Document or Upload File to get started.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
