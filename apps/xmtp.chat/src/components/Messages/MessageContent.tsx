import { Code, Image, Paper, Stack, Text } from "@mantine/core";
import * as secp from "@noble/secp256k1";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import {
  ContentTypeGroupUpdated,
  type GroupUpdated,
} from "@xmtp/content-type-group-updated";
import {
  ContentTypeRemoteAttachment,
  RemoteAttachmentCodec,
  type Attachment,
  type RemoteAttachment,
} from "@xmtp/content-type-remote-attachment";
import { ContentTypeReply, type Reply } from "@xmtp/content-type-reply";
import {
  ContentTypeTransactionReference,
  type TransactionReference,
} from "@xmtp/content-type-transaction-reference";
import {
  ContentTypeWalletSendCalls,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import { useEffect, useState } from "react";
import { FallbackContent } from "@/components/Messages/FallbackContent";
import { GroupUpdatedContent } from "@/components/Messages/GroupUpdatedContent";
import {
  MessageContentWrapper,
  type MessageContentAlign,
} from "@/components/Messages/MessageContentWrapper";
import { ReplyContent } from "@/components/Messages/ReplyContent";
import { TextContent } from "@/components/Messages/TextContent";
import { TransactionReferenceContent } from "@/components/Messages/TransactionReferenceContent";
import { WalletSendCallsContent } from "@/components/Messages/WalletSendCallsContent";
import { useXMTP } from "@/contexts/XMTPContext";

export type MessageContentProps = {
  align: MessageContentAlign;
  senderInboxId: string;
  message: DecodedMessage;
  scrollToMessage: (id: string) => void;
};

const ImageAttachment: React.FC<{
  attachment: RemoteAttachment;
  align: MessageContentAlign;
  senderInboxId: string;
  sentAtNs: bigint;
}> = ({ attachment, align, senderInboxId, sentAtNs }) => {
  const { client } = useXMTP();
  const [decryptedAttachment, setDecryptedAttachment] =
    useState<Attachment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const decryptAttachment = async () => {
      if (!client) {
        setError("Client not available");
        setLoading(false);
        return;
      }

      try {
        console.log("🔍 Starting attachment decryption:", {
          url: attachment.url,
          filename: attachment.filename,
          contentLength: attachment.contentLength,
          expectedDigest: attachment.contentDigest,
          scheme: attachment.scheme,
        });

        // First, let's try to fetch and verify manually for debugging
        try {
          console.log("📥 Fetching encrypted payload from:", attachment.url);
          const response = await fetch(attachment.url);

          if (!response.ok) {
            console.warn(`⚠️ HTTP ${response.status}: ${response.statusText}`);
          }

          const payload = new Uint8Array(await response.arrayBuffer());
          console.log("📊 Payload details:", {
            payloadSize: payload.length,
            expectedSize: attachment.contentLength,
            sizesMatch: payload.length === attachment.contentLength,
            contentType: response.headers.get("content-type"),
            status: response.status,
          });

          // Calculate digest using the same method as RemoteAttachmentCodec
          const digestBytes = new Uint8Array(
            await crypto.subtle.digest("SHA-256", payload),
          );
          const actualDigest = secp.etc.bytesToHex(digestBytes);

          console.log("🔐 Digest verification:", {
            expectedDigest: attachment.contentDigest,
            actualDigest: actualDigest,
            digestsMatch: actualDigest === attachment.contentDigest,
            expectedLength: attachment.contentDigest.length,
            actualLength: actualDigest.length,
          });

          if (actualDigest !== attachment.contentDigest) {
            console.error(
              "❌ Manual digest verification failed - but proceeding with RemoteAttachmentCodec.load anyway",
            );
          }
        } catch (debugError) {
          console.warn("⚠️ Manual fetch failed:", debugError);
        }

        // Now try the actual decryption with RemoteAttachmentCodec
        console.log("📋 Attempting RemoteAttachmentCodec.load...");
        const decrypted = await RemoteAttachmentCodec.load<Attachment>(
          attachment,
          client,
        );

        console.log("✅ XMTP decryption successful:", {
          filename: decrypted.filename,
          mimeType: decrypted.mimeType,
          dataSize: decrypted.data.length,
          estimatedFileSizeKB: Math.round(decrypted.data.length / 1024),
        });

        setDecryptedAttachment(decrypted);

        // Create blob URL for display
        const blob = new Blob([decrypted.data], {
          type: decrypted.mimeType,
        });
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
      } catch (err) {
        console.error("❌ Failed to decrypt attachment:", err);
        console.error("❌ Error details:", {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          attachment: {
            url: attachment.url,
            filename: attachment.filename,
            contentLength: attachment.contentLength,
            contentDigest: attachment.contentDigest,
          },
        });
        setError(
          `Failed to decrypt attachment: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
      }
    };

    void decryptAttachment();
  }, [attachment, client]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (loading) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={sentAtNs}>
        <Paper
          onClick={(event) => {
            event.stopPropagation();
          }}
          bg="var(--mantine-color-blue-filled)"
          c="white"
          py="xs"
          px="sm"
          radius="md">
          <Text>Loading attachment...</Text>
        </Paper>
      </MessageContentWrapper>
    );
  }

  if (error || !decryptedAttachment) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={sentAtNs}>
        <Paper
          onClick={(event) => {
            event.stopPropagation();
          }}
          bg="var(--mantine-color-blue-filled)"
          c="white"
          py="xs"
          px="sm"
          radius="md">
          <Text>{error || "Unable to display attachment"}</Text>
        </Paper>
      </MessageContentWrapper>
    );
  }

  if (!imageUrl) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={sentAtNs}>
        <Paper
          onClick={(event) => {
            event.stopPropagation();
          }}
          bg="var(--mantine-color-blue-filled)"
          c="white"
          py="xs"
          px="sm"
          radius="md">
          <Text>Processing attachment...</Text>
        </Paper>
      </MessageContentWrapper>
    );
  }

  console.log("📊 Image processing details:", {
    originalDataSize: decryptedAttachment.data.length,
    filename: decryptedAttachment.filename || "image",
    mimeType: decryptedAttachment.mimeType || "unknown",
  });

  return (
    <MessageContentWrapper
      align={align}
      senderInboxId={senderInboxId}
      sentAtNs={sentAtNs}>
      <Paper
        onClick={(event) => {
          event.stopPropagation();
        }}
        bg="var(--mantine-color-blue-filled)"
        c="white"
        py="xs"
        px="sm"
        radius="md">
        <Image
          src={imageUrl}
          alt={decryptedAttachment.filename}
          radius="sm"
          fit="contain"
          style={{ maxWidth: "300px", maxHeight: "300px" }}
        />
      </Paper>
    </MessageContentWrapper>
  );
};

export const MessageContent: React.FC<MessageContentProps> = ({
  message,
  align,
  senderInboxId,
  scrollToMessage,
}) => {
  if (message.contentType.sameAs(ContentTypeTransactionReference)) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <TransactionReferenceContent
          content={message.content as TransactionReference}
        />
      </MessageContentWrapper>
    );
  }

  if (message.contentType.sameAs(ContentTypeWalletSendCalls)) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <WalletSendCallsContent
          content={message.content as WalletSendCallsParams}
          conversationId={message.conversationId}
        />
      </MessageContentWrapper>
    );
  }

  if (message.contentType.sameAs(ContentTypeGroupUpdated)) {
    return (
      <GroupUpdatedContent
        content={message.content as GroupUpdated}
        sentAtNs={message.sentAtNs}
      />
    );
  }

  if (message.contentType.sameAs(ContentTypeRemoteAttachment)) {
    const attachment = message.content as RemoteAttachment;

    if (!attachment.filename) {
      return (
        <MessageContentWrapper
          align={align}
          senderInboxId={senderInboxId}
          sentAtNs={message.sentAtNs}>
          <Paper
            onClick={(event) => {
              event.stopPropagation();
            }}
            bg="var(--mantine-color-blue-filled)"
            c="white"
            py="xs"
            px="sm"
            radius="md">
            <Text>Unable to display attachment</Text>
          </Paper>
        </MessageContentWrapper>
      );
    }

    const isImage = attachment.filename
      .toLowerCase()
      .match(/\.(jpg|jpeg|png|gif|webp)$/);

    if (isImage) {
      return (
        <ImageAttachment
          attachment={attachment}
          align={align}
          senderInboxId={senderInboxId}
          sentAtNs={message.sentAtNs}
        />
      );
    }

    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <Paper
          onClick={(event) => {
            event.stopPropagation();
          }}
          bg="var(--mantine-color-blue-filled)"
          c="white"
          py="xs"
          px="sm"
          radius="md">
          <Stack gap="xs">
            <Text size="sm" style={{ wordBreak: "break-all" }}>
              {attachment.filename}
            </Text>
            <Text
              component="a"
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              c="white"
              style={{ textDecoration: "underline" }}>
              Download attachment
            </Text>
          </Stack>
        </Paper>
      </MessageContentWrapper>
    );
  }

  if (message.contentType.sameAs(ContentTypeReply)) {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <ReplyContent
          align={align}
          message={message as DecodedMessage<Reply>}
          scrollToMessage={scrollToMessage}
        />
      </MessageContentWrapper>
    );
  }

  if (typeof message.content === "string") {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <TextContent text={message.content} />
      </MessageContentWrapper>
    );
  }

  if (typeof message.fallback === "string") {
    return (
      <MessageContentWrapper
        align={align}
        senderInboxId={senderInboxId}
        sentAtNs={message.sentAtNs}>
        <FallbackContent text={message.fallback} />
      </MessageContentWrapper>
    );
  }

  return (
    <MessageContentWrapper
      align={align}
      senderInboxId={senderInboxId}
      sentAtNs={message.sentAtNs}>
      <Code
        block
        w="100%"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {JSON.stringify(message.content ?? message.fallback, null, 2)}
      </Code>
    </MessageContentWrapper>
  );
};
