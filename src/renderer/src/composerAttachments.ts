import type { ComposerAttachmentSelection } from '../../shared/api'
import type { UserInput } from './protocol'
import { serializeDiffComments, type DiffCommentAttachment } from './diffComments'

export const MAX_COMPOSER_ATTACHMENTS = 20

export function isDirectoryAttachmentPath(path: string): boolean {
  return path.endsWith('/')
}

export function mergeComposerAttachments(
  current: ComposerAttachmentSelection[],
  selected: ComposerAttachmentSelection[]
): ComposerAttachmentSelection[] {
  const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
  for (const attachment of selected) {
    if (!byPath.has(attachment.path)) byPath.set(attachment.path, attachment)
  }
  return [...byPath.values()].slice(0, MAX_COMPOSER_ATTACHMENTS)
}

export function buildTurnInput(
  draft: string,
  attachments: ComposerAttachmentSelection[],
  comments: readonly DiffCommentAttachment[] = []
): UserInput[] {
  const text = draft.trim() + serializeDiffComments(comments)
  return [
    ...(text ? [{ type: 'text' as const, text, text_elements: [] }] : []),
    ...attachments.map((attachment): UserInput =>
      attachment.kind === 'image'
        ? { type: 'localImage', path: attachment.path }
        : { type: 'mention', name: attachment.name, path: attachment.path }
    )
  ]
}
