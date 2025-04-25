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
  type Attachment,
  type RemoteAttachment,
} from "@xmtp/content-type-remote-attachment";
import { useEffect, useRef, useState } from "react";
import { useConversation } from "@/hooks/useConversation";
import classes from "./Composer.module.css";

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = import.meta.env.VITE_CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = import.meta.env.VITE_CLOUDINARY_API_SECRET;

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

const uploadImageToCloudinary = async (
  base64Image: string,
): Promise<UploadResponse> => {
  try {
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

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `Failed to upload image to Cloudinary: ${error.message || response.statusText}`,
      );
    }

    const data = await response.json();
    return {
      url: data.secure_url,
      size: data.bytes,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
    }
    throw error;
  }
};

const uploadImageToIPFS = async (params: {
  pinataConfig: PinataConfig;
  base64Image: string;
  name?: string;
  metadata?: Record<string, string>;
}): Promise<UploadResponse> => {
  try {
    const formData = new FormData();

    // Convert base64 to Blob and then to File
    const base64Data = params.base64Image.split(",")[1] || params.base64Image;
    const byteCharacters = atob(base64Data);
    const byteArrays: Uint8Array[] = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
      const slice = byteCharacters.slice(offset, offset + 1024);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    let mimeType = "image/png";
    if (params.base64Image.startsWith("data:")) {
      mimeType = params.base64Image.split(";")[0].split(":")[1];
    }

    const blob = new Blob(byteArrays, { type: mimeType });
    const extension = mimeType.split("/")[1];
    const fileName = `image.${extension}`;
    const file = new File([blob], fileName, { type: mimeType });

    formData.append("file", file);

    const pinataMetadata = {
      name: params.name || null,
      keyvalues: params.metadata || {},
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
      const error = await response.json();
      throw new Error(
        `Failed to upload image to IPFS: ${
          error.message || response.statusText
        }`,
      );
    }

    const data = await response.json();
    return {
      url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
      size: data.PinSize,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to upload image to IPFS: ${error.message}`);
    }
    throw error;
  }
};

export type ComposerProps = {
  conversation: Conversation;
};

export const Composer: React.FC<ComposerProps> = ({ conversation }) => {
  const { send, sending } = useConversation(conversation);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileButtonKey, setFileButtonKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File | null) => {
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
        // Convert file to base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => {
            const base64 = reader.result as string;
            resolve(base64);
          };
        });
        reader.readAsDataURL(selectedFile);
        const base64Image = await base64Promise;

        // Try Pinata first, fallback to Cloudinary
        let uploadResponse: UploadResponse;
        try {
          if (!PINATA_JWT) {
            throw new Error("Pinata JWT not configured");
          }

          const pinataConfig = {
            jwt: PINATA_JWT,
          };

          uploadResponse = await uploadImageToIPFS({
            pinataConfig,
            base64Image,
            name: selectedFile.name,
          });
          console.log("Successfully uploaded to IPFS");
        } catch (pinataError) {
          console.log(
            "Pinata upload failed, falling back to Cloudinary:",
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

          uploadResponse = await uploadImageToCloudinary(base64Image);
          console.log("Successfully uploaded to Cloudinary");
        }

        // Create attachment using ArrayBuffer
        const arrayBuffer = await new Promise<ArrayBuffer>((resolve) => {
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(selectedFile);
        });

        const attachment = {
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          data: new Uint8Array(arrayBuffer),
        };

        // Encrypt the attachment
        const encryptedContent = await RemoteAttachmentCodec.encodeEncrypted(
          attachment,
          new AttachmentCodec(),
        );

        // Create remote attachment using the upload URL
        const remoteAttachment: RemoteAttachment = {
          url: uploadResponse.url,
          contentDigest: encryptedContent.digest,
          salt: encryptedContent.salt,
          nonce: encryptedContent.nonce,
          secret: encryptedContent.secret,
          scheme: "https",
          contentLength: arrayBuffer.byteLength,
          filename: selectedFile.name,
          text: message.trim() || undefined,
        };

        console.log("Sending attachment:", {
          remoteAttachment,
          message: message.trim(),
        });

        // Send both attachment and text in a single message
        await send("", {
          contentType: ContentTypeRemoteAttachment,
          content: remoteAttachment,
        });

        console.log("Message sent");

        setMessage("");
        setSelectedFile(null);
        setPreviewUrl(null);
      } catch (error) {
        console.error("Failed to upload image:", error);
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
            onChange={handleFileSelect}
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
