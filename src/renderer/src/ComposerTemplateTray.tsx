import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Globe,
  LayoutTemplate,
  Monitor,
  MoreHorizontal,
  Presentation,
  Sigma,
  Sparkles,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  COMPOSER_DOCUMENT_TEMPLATES,
  type ComposerDocumentTemplate,
  type ComposerPluginMention
} from './composerRichDraft'

function PluginIcon({ pluginId }: { pluginId: string }): ReactNode {
  switch (pluginId) {
    case 'documents': return <FileText />
    case 'pdf': return <FileOutput />
    case 'spreadsheets': return <FileSpreadsheet />
    case 'presentations': return <Presentation />
    case 'template-creator': return <LayoutTemplate />
    case 'browser': return <Globe />
    case 'computer': return <Monitor />
    case 'latex': return <Sigma />
    case 'visualize': return <Sparkles />
    case 'zotero': return <BookOpen />
    default: return <Sparkles />
  }
}

export function ComposerPluginMentionChip({
  mention,
  onRemove
}: {
  mention: ComposerPluginMention
  onRemove(): void
}): ReactNode {
  return (
    <span className={`composer-plugin-mention is-${mention.id}`} aria-label={mention.label}>
      <PluginIcon pluginId={mention.id} />
      <span>{mention.label}</span>
      <button
        type="button"
        className="composer-plugin-mention-remove"
        aria-label={`移除 ${mention.label}`}
        title={`移除 ${mention.label}`}
        onClick={onRemove}
      >
        <X />
      </button>
    </span>
  )
}

export function ComposerTemplateTray({
  onUse,
  onClose,
  onCreateTemplate,
  onViewAll
}: {
  onUse(template: ComposerDocumentTemplate): void
  onClose(): void
  onCreateTemplate(): void
  onViewAll(): void
}): ReactNode {
  return (
    <section className="composer-template-tray" aria-label="Templates">
      <div className="composer-template-tray-header">
        <h2>Templates</h2>
        <div className="composer-template-tray-actions">
          <button type="button" className="composer-template-create" onClick={onCreateTemplate}>
            Create template
          </button>
          <button type="button" className="composer-template-page" aria-label="Previous templates" disabled>
            <ChevronLeft />
          </button>
          <button type="button" className="composer-template-page" aria-label="Next templates" disabled>
            <ChevronRight />
          </button>
          <button type="button" className="composer-template-close" aria-label="关闭模板" onClick={onClose}>
            <X />
          </button>
        </div>
      </div>
      <div className="composer-template-grid">
        {COMPOSER_DOCUMENT_TEMPLATES.map((template) => (
          <article className="composer-template-card" key={template.id}>
            <button
              type="button"
              className="composer-template-use"
              aria-label={`Use ${template.name}`}
              onClick={() => onUse(template)}
            >
              <span className="composer-template-preview" aria-hidden="true">
                <strong>{template.previewTitle}</strong>
                <small>{template.previewSubtitle}</small>
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="composer-template-name">{template.name}</span>
              <span className="composer-template-kind">Word</span>
            </button>
            <button
              type="button"
              className="composer-template-more"
              aria-label={`More actions for ${template.name}`}
              title={`More actions for ${template.name}`}
            >
              <MoreHorizontal />
            </button>
          </article>
        ))}
        <button type="button" className="composer-template-view-all" onClick={onViewAll}>
          <span aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          View all
        </button>
      </div>
    </section>
  )
}
