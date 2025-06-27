# XMTP Image Attachment Implementation

## Overview

This document details the current implementation of image attachment handling in the XMTP chat application. The implementation follows the official XMTP RemoteAttachment specification and ensures proper separation of image and text messages for better compatibility and user experience.

## Current Implementation

### Message Flow

The application handles image attachments using a two-message approach:

1. **Image Upload & Encryption**: Images are uploaded to IPFS via Pinata (with Cloudinary fallback) and encrypted using XMTP's official RemoteAttachmentCodec
2. **Separate Message Sending**:
   - Image attachment is sent as the first message (ContentType: RemoteAttachment)
   - Optional text is sent as a separate follow-up message (ContentType: Text)
3. **Clean Display**: Each message type is displayed appropriately in the conversation

## Components

### 1. Composer Component

Located in `apps/xmtp.chat/src/components/Conversation/Composer.tsx`

#### Key Features

- Image file selection with type validation
- Image preview before sending
- Standardized filename formatting
- IPFS upload via Pinata
- XMTP attachment encryption
- Separate message handling for text and attachments

#### File Selection & Preview

```typescript
const handleFileSelect = async (file: File | null) => {
  if (!file) return;

  // Validate image type
  if (!file.type.startsWith("image/")) {
    alert("Please select an image file");
    return;
  }

  // Standardize filename
  const extension = file.type.split("/")[1];
  const standardizedFileName = `image.${extension}`;
  const newFile = new File([file], standardizedFileName, { type: file.type });

  setSelectedFile(newFile);
  const preview = URL.createObjectURL(newFile);
  setPreviewUrl(preview);
};
```

#### IPFS Upload Process

```typescript
const uploadImageToIPFS = async (params: {
  pinataConfig: PinataConfig;
  base64Image: string;
  metadata?: Record<string, string>;
}): Promise<UploadResponse> => {
  // Convert base64 to Blob
  const base64Data = params.base64Image.split(",")[1] || params.base64Image;
  const byteCharacters = atob(base64Data);
  const byteArrays: Uint8Array[] = [];

  // Process in chunks
  for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
    const slice = byteCharacters.slice(offset, offset + 1024);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  // Create file with standardized name
  const mimeType = params.base64Image.startsWith("data:")
    ? params.base64Image.split(";")[0].split(":")[1]
    : "image/png";
  const extension = mimeType.split("/")[1];
  const fileName = `image.${extension}`;
  const blob = new Blob(byteArrays, { type: mimeType });
  const file = new File([blob], fileName, { type: mimeType });

  // Upload to Pinata
  const formData = new FormData();
  formData.append("file", file);
  formData.append(
    "pinataMetadata",
    JSON.stringify({
      name: fileName,
      keyvalues: params.metadata || {},
    }),
  );
  formData.append(
    "pinataOptions",
    JSON.stringify({
      cidVersion: 1,
    }),
  );

  const response = await fetch(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.pinataConfig.jwt}`,
      },
      body: formData,
    },
  );

  return await response.json();
};
```

#### Message Sending Implementation

```typescript
// Send the attachment first
await send("", {
  contentType: ContentTypeRemoteAttachment,
  content: remoteAttachment,
});

// Then send text as separate message if provided
if (message.trim()) {
  await send(message.trim());
}
```

This approach ensures:

- Clean separation of content types
- Better compatibility with XMTP clients
- Proper message ordering in conversations

### 2. MessageContent Component

Located in `apps/xmtp.chat/src/components/Messages/MessageContent.tsx`

#### Key Features

- Differentiated handling of image vs non-image attachments
- Image preview rendering
- Download link for non-image attachments
- Filename display

#### Current Display Logic

Images are displayed directly from their uploaded URLs with filename labels:

```typescript
if (message.contentType.sameAs(ContentTypeRemoteAttachment)) {
  const attachment = message.content as RemoteAttachment;
  const isImage = attachment.filename.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/);

  if (isImage) {
    return (
      <Stack gap="xs">
        <Image src={attachment.url} alt={attachment.filename} />
        <Text size="xs" c="gray.3">{attachment.filename}</Text>
      </Stack>
    );
  }
}
}
```

## Technical Specifications

### RemoteAttachment Implementation

The implementation follows XMTP's official RemoteAttachment specification:

```typescript
type RemoteAttachment = {
  url: string;
  contentDigest: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  secret: Uint8Array;
  scheme: string;
  contentLength: number;
  filename: string;
};
```

### Supported Image Types

- PNG (.png)
- JPEG (.jpg, .jpeg)
- GIF (.gif)
- WebP (.webp)

### Upload Strategy

**Primary**: IPFS via Pinata  
**Fallback**: Cloudinary CDN

Both services provide reliable image hosting with proper HTTPS URLs required by XMTP RemoteAttachment specification.

## Configuration

### Environment Variables

- `VITE_PINATA_JWT`: Pinata API JWT for IPFS uploads
- `VITE_CLOUDINARY_CLOUD_NAME`: Cloudinary cloud name (fallback)
- `VITE_CLOUDINARY_API_KEY`: Cloudinary API key (fallback)
- `VITE_CLOUDINARY_API_SECRET`: Cloudinary API secret (fallback)

### Key Dependencies

- `@xmtp/content-type-remote-attachment`: Official XMTP remote attachment codec
- `@mantine/core`: UI components for image display and file selection

## Architecture Benefits

- **XMTP Compliant**: Follows official RemoteAttachment specification
- **Dual Message Flow**: Clean separation of images and text
- **Reliable Upload**: Primary IPFS with CDN fallback
- **End-to-End Encryption**: All attachments encrypted via XMTP codec
- **Cross-Client Compatible**: Works with other XMTP applications
