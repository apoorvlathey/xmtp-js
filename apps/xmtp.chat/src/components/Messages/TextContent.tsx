import { Anchor, Paper, Text } from "@mantine/core";
import { Fragment } from "react";
import classes from "./TextContent.module.css";

export type TextContentProps = {
  text: string;
};

// URL regex pattern that matches http/https URLs
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const parseTextWithLinks = (text: string) => {
  const parts = text.split(URL_REGEX);

  return parts.map((part, index) => {
    if (URL_REGEX.test(part)) {
      return (
        <Anchor
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          c="white"
          style={{ textDecoration: "underline" }}>
          {part}
        </Anchor>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
};

export const TextContent: React.FC<TextContentProps> = ({ text }) => {
  return (
    <Paper
      className={classes.text}
      onClick={(event) => {
        event.stopPropagation();
      }}
      bg="var(--mantine-color-blue-filled)"
      c="white"
      py="xs"
      px="sm"
      radius="md">
      <Text
        component="pre"
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "inherit",
        }}>
        {parseTextWithLinks(text)}
      </Text>
    </Paper>
  );
};
