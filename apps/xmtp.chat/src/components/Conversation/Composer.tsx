import {
  Button,
  FileButton,
  Group,
  Image,
  Stack,
  TextInput,
} from "@mantine/core";
import type { Conversation } from "@xmtp/browser-sdk";
import {
  AttachmentCodec,
  ContentTypeRemoteAttachment,
  RemoteAttachmentCodec,
  // type Attachment,
  type RemoteAttachment,
} from "@xmtp/content-type-remote-attachment";
import { useEffect, useRef, useState } from "react";
import type { ContentTypes } from "@/contexts/XMTPContext";
import { useConversation } from "@/hooks/useConversation";
import classes from "./Composer.module.css";

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT as string;
const CLOUDINARY_CLOUD_NAME = import.meta.env
  .VITE_CLOUDINARY_CLOUD_NAME as string;
const CLOUDINARY_API_KEY = import.meta.env.VITE_CLOUDINARY_API_KEY as string;
const CLOUDINARY_API_SECRET = import.meta.env
  .VITE_CLOUDINARY_API_SECRET as string;

type PinataConfig = {
  jwt: string;
};

type UploadResponse = {
  url: string;
  size: number;
};

const generateCloudinarySignature = async (
  timestamp: number,
): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const uploadEncryptedPayloadToCloudinary = async (
  encryptedPayload: Uint8Array,
): Promise<UploadResponse> => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = await generateCloudinarySignature(timestamp);

    // Convert Uint8Array to base64
    const base64Data = btoa(String.fromCharCode(...encryptedPayload));
    const dataUri = `data:application/octet-stream;base64,${base64Data}`;

    const formData = new FormData();
    formData.append("file", dataUri);
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);
    formData.append("resource_type", "raw"); // Important: treat as raw binary data

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as { message: string };
      throw new Error(
        `Failed to upload encrypted payload to Cloudinary: ${error.message || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      secure_url: string;
      bytes: number;
    };
    return {
      url: data.secure_url,
      size: data.bytes,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to upload encrypted payload to Cloudinary: ${error.message}`,
      );
    }
    throw error;
  }
};

const uploadEncryptedPayloadToIPFS = async (params: {
  pinataConfig: PinataConfig;
  encryptedPayload: Uint8Array;
  filename?: string;
}): Promise<UploadResponse> => {
  try {
    const formData = new FormData();

    // Create a blob from the encrypted payload
    const blob = new Blob([params.encryptedPayload], {
      type: "application/octet-stream",
    });
    const file = new File([blob], params.filename || "encrypted_attachment", {
      type: "application/octet-stream",
    });

    formData.append("file", file);

    const pinataMetadata = {
      name: params.filename || "encrypted_attachment",
      keyvalues: {
        type: "xmtp_encrypted_attachment",
      },
    };
    formData.append("pinataMetadata", JSON.stringify(pinataMetadata));

    const pinataOptions = {
      cidVersion: 1,
    };
    formData.append("pinataOptions", JSON.stringify(pinataOptions));

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

    if (!response.ok) {
      const error = (await response.json()) as { message: string };
      throw new Error(
        `Failed to upload encrypted payload to IPFS: ${
          error.message || response.statusText
        }`,
      );
    }

    const data = (await response.json()) as {
      IpfsHash: string;
      PinSize: number;
    };
    return {
      url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
      size: data.PinSize,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to upload encrypted payload to IPFS: ${error.message}`,
      );
    }
    throw error;
  }
};

export type ComposerProps = {
  conversation: Conversation<ContentTypes>;
};

export const Composer: React.FC<ComposerProps> = ({ conversation }) => {
  const { send, sending } = useConversation(conversation);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileButtonKey, setFileButtonKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File | null) => {
    if (!file) return;

    // Check if file is an image
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    // Get file extension from mime type
    const extension = file.type.split("/")[1];
    const standardizedFileName = `image.${extension}`;

    // Create a new File object with standardized name
    const newFile = new File([file], standardizedFileName, { type: file.type });
    setSelectedFile(newFile);

    // Create preview URL
    const preview = URL.createObjectURL(newFile);
    setPreviewUrl(preview);
  };

  // Cleanup preview URL when component unmounts or file changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleSend = async () => {
    if (selectedFile) {
      setUploading(true);
      try {
        console.log("🚀 Starting attachment upload process...");

        // Step 1: Create attachment object from file
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result as ArrayBuffer);
          };
          reader.readAsArrayBuffer(selectedFile);
        });

        const attachment = {
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          data: new Uint8Array(arrayBuffer),
        };

        console.log("📁 Created attachment object:", {
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          dataSize: attachment.data.length,
        });

        // Step 2: Encrypt the attachment
        console.log("🔐 Encrypting attachment...");
        const encryptedContent = await RemoteAttachmentCodec.encodeEncrypted(
          attachment,
          new AttachmentCodec(),
        );

        console.log("✅ Attachment encrypted:", {
          digest: encryptedContent.digest,
          payloadSize: encryptedContent.payload.length,
        });

        // Step 3: Upload the ENCRYPTED payload to storage
        console.log("☁️ Uploading encrypted payload...");
        let uploadResponse: UploadResponse;

        try {
          if (!PINATA_JWT) {
            throw new Error("Pinata JWT not configured");
          }

          const pinataConfig = {
            jwt: PINATA_JWT,
          };

          // Upload the encrypted payload as binary data
          uploadResponse = await uploadEncryptedPayloadToIPFS({
            pinataConfig,
            encryptedPayload: encryptedContent.payload,
            filename: `encrypted_${selectedFile.name}`,
          });
          console.log("✅ Successfully uploaded encrypted payload to IPFS");
        } catch (pinataError) {
          console.log(
            "⚠️ Pinata upload failed, falling back to Cloudinary:",
            pinataError,
          );

          if (
            !CLOUDINARY_CLOUD_NAME ||
            !CLOUDINARY_API_KEY ||
            !CLOUDINARY_API_SECRET
          ) {
            throw new Error(
              "Neither Pinata JWT nor Cloudinary credentials are configured. Please set either VITE_PINATA_JWT or Cloudinary environment variables in your .env file.",
            );
          }

          uploadResponse = await uploadEncryptedPayloadToCloudinary(
            encryptedContent.payload,
          );
          console.log(
            "✅ Successfully uploaded encrypted payload to Cloudinary",
          );
        }

        // Step 4: Create remote attachment with encrypted payload URL
        const remoteAttachment: RemoteAttachment = {
          url: uploadResponse.url,
          contentDigest: encryptedContent.digest,
          salt: encryptedContent.salt,
          nonce: encryptedContent.nonce,
          secret: encryptedContent.secret,
          scheme: "https://",
          filename: attachment.filename,
          contentLength: encryptedContent.payload.length, // Size of encrypted payload
        };

        console.log("📦 Created remote attachment:", {
          url: remoteAttachment.url,
          filename: remoteAttachment.filename,
          contentLength: remoteAttachment.contentLength,
          digest: remoteAttachment.contentDigest,
        });

        // Step 5: Send the remote attachment
        console.log("📤 Sending remote attachment...");
        await send("", {
          contentType: ContentTypeRemoteAttachment,
          content: remoteAttachment,
        });

        // If there's a text message, send it separately
        if (message.trim()) {
          await send(message.trim());
        }

        console.log("✅ Message sent successfully!");

        setMessage("");
        setSelectedFile(null);
        setPreviewUrl(null);
        setFileButtonKey((prev) => prev + 1); // Reset FileButton to allow same file selection
      } catch (error) {
        console.error("❌ Failed to upload image:", error);
        alert("Failed to upload image. Please try again.");
      } finally {
        setUploading(false);
      }
    } else if (message.trim()) {
      await send(message);
      setMessage("");
    }

    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileButtonKey((prev) => prev + 1);
  };

  return (
    <Stack w="100%" gap="xs">
      {previewUrl && (
        <Group justify="flex-start" p="md" w="100%">
          <Stack gap={0}>
            <Image
              src={previewUrl}
              alt="Preview"
              radius="sm"
              fit="contain"
              style={{ maxWidth: "200px", maxHeight: "200px" }}
            />
            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={handleRemoveFile}>
              Remove
            </Button>
          </Stack>
        </Group>
      )}
      <Group
        align="center"
        gap="xs"
        wrap="nowrap"
        p="md"
        w="100%"
        className={classes.root}>
        <TextInput
          ref={inputRef}
          disabled={sending || uploading}
          size="md"
          placeholder={
            selectedFile ? "Add a message (optional)..." : "Type a message..."
          }
          w="100%"
          value={message}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleSend();
            }
          }}
          onChange={(e) => {
            setMessage(e.target.value);
          }}
        />
        <Group gap="xs" wrap="nowrap">
          <FileButton
            key={fileButtonKey}
            onChange={(file) => {
              handleFileSelect(file);
            }}
            accept="image/*">
            {(props) => (
              <Button
                {...props}
                size="md"
                variant="outline"
                disabled={sending || uploading}>
                📎
              </Button>
            )}
          </FileButton>
          <Button
            disabled={message.length === 0 && !selectedFile}
            loading={sending || uploading}
            size="md"
            onClick={() => void handleSend()}>
            Send
          </Button>
        </Group>
      </Group>
    </Stack>
  );
};
