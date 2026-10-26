import type { ReactNode } from 'react'
import { ThreadImagePreview } from './ThreadImagePreview'
import './userMessageImages.css'

export interface UserMessageImageAttachment {
  path: string
  name: string
}

export function UserMessageImages({
  images
}: {
  images: readonly UserMessageImageAttachment[]
}): ReactNode {
  if (!images.length) return null
  return (
    <div
      className="user-message-images"
      aria-label={images.length === 1 ? '输入图片' : `${images.length} 张输入图片`}
    >
      {images.map((image, index) => (
        <ThreadImagePreview
          path={image.path}
          label={image.name}
          presentation="message"
          key={`${image.path}:${index}`}
        />
      ))}
    </div>
  )
}
