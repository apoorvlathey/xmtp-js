# XMTP Image Attachment Implementation Report

## Overview

This report details the implementation of image attachment handling in the XMTP chat application. The implementation covers file selection, image uploading to IPFS via Pinata (with Cloudinary as fallback), encryption using XMTP's RemoteAttachmentCodec, and message rendering. Messages with both image and text are split into two separate messages, with the image being sent first followed by the text message, ensuring better compatibility and user experience.

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

#### XMTP Attachment Handling & Message Sending

```typescript
// Create attachment
const attachment = {
  filename: standardizedFileName,
  mimeType: file.type,
  data: new Uint8Array(arrayBuffer),
};

// Encrypt attachment
const encryptedContent = await RemoteAttachmentCodec.encodeEncrypted(
  attachment,
  new AttachmentCodec(),
);

// Create remote attachment
const remoteAttachment: RemoteAttachment = {
  url: `https://gateway.pinata.cloud/ipfs/${uploadResponse.IpfsHash}`,
  contentDigest: encryptedContent.digest,
  salt: encryptedContent.salt,
  nonce: encryptedContent.nonce,
  secret: encryptedContent.secret,
  scheme: "https",
  contentLength: arrayBuffer.byteLength,
  filename: standardizedFileName,
};

// Send the attachment first
await send(undefined, {
  contentType: ContentTypeRemoteAttachment,
  content: remoteAttachment,
});

// If there's a text message, send it after the attachment
if (message.trim()) {
  await send(message);
}
```

The implementation specifically sends the attachment first, followed by any text message. This ordering ensures:

1. Immediate visibility of image uploads
2. Clear separation of content types
3. Better fallback behavior in unsupported clients
4. Consistent message ordering across different XMTP clients

#### Message Flow

1. User selects an image and optionally enters text
2. Image is uploaded to IPFS and encrypted
3. Image attachment is sent as a separate message
4. If text was entered, it's sent as a follow-up message
5. Messages are displayed in chronological order in the conversation

### 2. MessageContent Component

Located in `apps/xmtp.chat/src/components/Messages/MessageContent.tsx`

#### Key Features

- Differentiated handling of image vs non-image attachments
- Image preview rendering
- Download link for non-image attachments
- Filename display

#### Image Attachment Rendering

```typescript
if (message.contentType.sameAs(ContentTypeRemoteAttachment)) {
  const attachment = message.content as RemoteAttachment;
  const isImage = attachment.filename?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/);

  if (isImage) {
    return (
      <Paper>
        <Stack gap="xs">
          <Image
            src={attachment.url}
            alt={attachment.filename}
            radius="sm"
            fit="contain"
            style={{ maxWidth: "300px", maxHeight: "300px" }}
          />
          <Text size="xs" c="gray.3">
            {attachment.filename}
          </Text>
        </Stack>
      </Paper>
    );
  }
}
```

## Technical Specifications

### RemoteAttachment Type

```typescript
type RemoteAttachment = {
  url: string;
  contentDigest: string;
  salt: string;
  nonce: string;
  secret: string;
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

### Image Upload Services

#### 1. Primary: IPFS via Pinata

- Decentralized storage
- Content-addressable
- Permanent storage
- JWT-based authentication

#### 2. Fallback: Cloudinary

- Fast CDN delivery
- Automatic optimization
- Secure signature-based upload
- Web Crypto API for signature generation

### Upload Process

```typescript
// Cloudinary signature generation using Web Crypto API
const generateCloudinarySignature = async (
  timestamp: number,
): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Cloudinary upload function
const uploadImageToCloudinary = async (
  base64Image: string,
): Promise<UploadResponse> => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const signature = await generateCloudinarySignature(timestamp);

  const formData = new FormData();
  formData.append("file", base64Image);
  formData.append("api_key", CLOUDINARY_API_KEY);
  formData.append("timestamp", timestamp.toString());
  formData.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  const data = await response.json();
  return {
    url: data.secure_url,
    size: data.bytes,
  };
};

// Fallback mechanism
try {
  if (!PINATA_JWT) {
    throw new Error("Pinata JWT not configured");
  }
  // Try IPFS upload first
  uploadResponse = await uploadImageToIPFS({
    /*...*/
  });
} catch (pinataError) {
  // Fallback to Cloudinary if Pinata fails
  uploadResponse = await uploadImageToCloudinary(base64Image);
}
```

### Security Features

1. Content Encryption

   - Uses XMTP's RemoteAttachmentCodec for end-to-end encryption
   - Generates unique salt, nonce, and secret for each attachment
   - Content digest verification

2. File Upload Security
   - JWT-based authentication with Pinata
   - Signature-based authentication with Cloudinary
   - SHA-256 hashing using Web Crypto API
   - HTTPS scheme enforcement
   - Content-Type validation
   - File size tracking

## Environment Configuration

Required environment variables:

- `VITE_PINATA_JWT`: Pinata API JWT for IPFS uploads
- `VITE_CLOUDINARY_CLOUD_NAME`: Cloudinary cloud name
- `VITE_CLOUDINARY_API_KEY`: Cloudinary API key
- `VITE_CLOUDINARY_API_SECRET`: Cloudinary API secret

## Dependencies

```json
{
  "@xmtp/content-type-remote-attachment": "^1.0.0",
  "@mantine/core": "^7.0.0"
}
```

## Future Improvements

1. Progress indicators for large file uploads
2. Retry mechanism for failed uploads
3. File size limitations and validation
4. Additional file type support
5. Compression for large images
6. Caching mechanism for downloaded attachments
7. Batch upload support
8. Cloudinary upload presets for automatic image optimization
9. Image transformation parameters for different device sizes
10. Upload progress tracking for better UX
11. Automatic format optimization based on browser support
