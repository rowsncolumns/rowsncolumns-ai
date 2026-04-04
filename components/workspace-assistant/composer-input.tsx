"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { useCallbackRef } from "@rowsncolumns/spreadsheet";
import { matchSorter, rankings } from "match-sorter";

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type ComposerMentionCategory = "sheet" | "document";

export type ComposerMentionOption = {
  id: string;
  label: string;
  category: ComposerMentionCategory;
  description?: string;
};

type AssistantComposerInputProps = {
  value: string;
  placeholder: string;
  mentionOptions: ComposerMentionOption[];
  onSearchMentions?: (query: string) => Promise<ComposerMentionOption[]>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPasteFiles?: (files: File[]) => void;
};

type MentionMenuState = {
  open: boolean;
  items: ComposerMentionOption[];
  selectedIndex: number;
  query: string;
  command: ((item: ComposerMentionOption) => void) | null;
  position: {
    top: number;
    left: number;
  } | null;
};

const CLOSED_MENTION_MENU: MentionMenuState = {
  open: false,
  items: [],
  selectedIndex: 0,
  query: "",
  command: null,
  position: null,
};

const MENTION_CATEGORY_LABELS: Record<ComposerMentionCategory, string> = {
  sheet: "Sheets",
  document: "Documents",
};

const MENTION_CATEGORY_ORDER: ComposerMentionCategory[] = ["sheet", "document"];

const normalizeComposerValue = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();

const escapeMarkdownText = (value: string): string =>
  value.replace(/[[\]\\]/g, "\\$&");

const unescapeMarkdownText = (value: string): string =>
  value.replace(/\\([[\]\\])/g, "$1");

const formatMentionMarkdown = (label: string, url: string): string =>
  `[${escapeMarkdownText(label)}](${escapeMarkdownText(url)})`;

const MENTION_MARKDOWN_PATTERN =
  /\[([^\]\n]+)\]\(([^)\n]+)\)|\[([^\]\n]+)\]\[([^\]\n]+)\]/g;
const MENTION_MARKDOWN_DETECT_PATTERN =
  /\[[^\]\n]+\]\([^)]+\)|\[[^\]\n]+\]\[[^\]\n]+\]/;

const buildLineContent = (
  line: string,
): Array<
  | { type: "text"; text: string }
  | { type: "mention"; attrs: { id: string; label: string } }
> => {
  const nodes: Array<
    | { type: "text"; text: string }
    | { type: "mention"; attrs: { id: string; label: string } }
  > = [];
  let cursor = 0;

  line.replace(
    MENTION_MARKDOWN_PATTERN,
    (
      fullMatch: string,
      markdownLabel: string | undefined,
      markdownUrl: string | undefined,
      legacyLabel: string | undefined,
      legacyUrl: string | undefined,
      index: number,
    ) => {
      const safeIndex = typeof index === "number" ? index : cursor;
      if (safeIndex > cursor) {
        nodes.push({
          type: "text",
          text: line.slice(cursor, safeIndex),
        });
      }

      const label = unescapeMarkdownText(
        (markdownLabel ?? legacyLabel ?? "").trim(),
      );
      const url = unescapeMarkdownText((markdownUrl ?? legacyUrl ?? "").trim());
      if (label && url) {
        nodes.push({
          type: "mention",
          attrs: {
            id: url,
            label,
          },
        });
      } else {
        nodes.push({
          type: "text",
          text: fullMatch,
        });
      }

      cursor = safeIndex + fullMatch.length;
      return fullMatch;
    },
  );

  if (cursor < line.length) {
    nodes.push({
      type: "text",
      text: line.slice(cursor),
    });
  }

  return nodes;
};

const buildPlainTextDocument = (value: string) => {
  const normalized = normalizeComposerValue(value);
  if (!normalized) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  return {
    type: "doc",
    content: normalized.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? buildLineContent(line) : [],
    })),
  };
};

const buildPasteInsertContent = (value: string) => {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length === 1) {
    const inlineContent = buildLineContent(lines[0] ?? "");
    if (inlineContent.length === 0) {
      return [{ type: "text", text: lines[0] ?? "" }];
    }
    return inlineContent;
  }

  return lines.map((line) => ({
    type: "paragraph",
    content: line ? buildLineContent(line) : [],
  }));
};

const filterMentionOptions = (
  items: ComposerMentionOption[],
  query: string,
): ComposerMentionOption[] => {
  const normalizedQuery = query.trim();
  const byCategory = new Map<
    ComposerMentionCategory,
    ComposerMentionOption[]
  >();
  for (const item of items) {
    const existing = byCategory.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      byCategory.set(item.category, [item]);
    }
  }

  const results: ComposerMentionOption[] = [];
  for (const category of MENTION_CATEGORY_ORDER) {
    const categoryItems = byCategory.get(category) ?? [];
    if (categoryItems.length === 0) {
      continue;
    }

    const rankedItems =
      normalizedQuery.length === 0
        ? [...categoryItems].sort((left, right) =>
            left.label.localeCompare(right.label, undefined, {
              sensitivity: "base",
            }),
          )
        : matchSorter(categoryItems, normalizedQuery, {
            threshold: rankings.CONTAINS,
            keys: [
              "label",
              "id",
              (item) => item.description ?? "",
              () => MENTION_CATEGORY_LABELS[category],
            ],
          });

    results.push(...rankedItems);
  }

  return results.slice(0, 12);
};

const groupMentionOptions = (items: ComposerMentionOption[]) => {
  const grouped = new Map<ComposerMentionCategory, ComposerMentionOption[]>();
  for (const item of items) {
    const previous = grouped.get(item.category);
    if (previous) {
      previous.push(item);
    } else {
      grouped.set(item.category, [item]);
    }
  }
  return grouped;
};

const createMentionSuggestion = ({
  getItems,
  getSearchItems,
  onLoadingDelta,
  onAsyncItemsResolved,
  onMenuStateChange,
}: {
  getItems: () => ComposerMentionOption[];
  getSearchItems?: () =>
    | ((query: string) => Promise<ComposerMentionOption[]>)
    | undefined;
  onLoadingDelta?: (delta: 1 | -1) => void;
  onAsyncItemsResolved?: (payload: {
    query: string;
    items: ComposerMentionOption[];
  }) => void;
  onMenuStateChange: (state: MentionMenuState) => void;
}): Omit<
  SuggestionOptions<ComposerMentionOption, MentionNodeAttrs>,
  "editor"
> => ({
  char: "@",
  allowSpaces: true,
  items: async ({ query }: { query: string }) => {
    const localItems = filterMentionOptions(getItems(), query);
    const searchItems = getSearchItems?.();
    if (!searchItems) {
      return localItems;
    }

    onLoadingDelta?.(1);
    void searchItems(query)
      .then((resolvedItems) => {
        onAsyncItemsResolved?.({
          query,
          items: resolvedItems,
        });
      })
      .finally(() => {
        onLoadingDelta?.(-1);
      });

    return localItems;
  },
  command: ({ editor, range, props }) => {
    const mentionId = props.id?.trim();
    if (!mentionId) {
      return;
    }
    const mentionLabel = props.label?.trim() || mentionId;
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: "mention",
          attrs: {
            id: mentionId,
            label: mentionLabel,
          },
        },
        { type: "text", text: " " },
      ])
      .run();
  },
  render: () => {
    let selectedIndex = 0;
    let activeProps: SuggestionProps<
      ComposerMentionOption,
      MentionNodeAttrs
    > | null = null;

    const closeMenu = () => {
      onMenuStateChange(CLOSED_MENTION_MENU);
    };

    const publishMenu = () => {
      if (!activeProps) {
        closeMenu();
        return;
      }

      const safeItems = activeProps.items;
      if (safeItems.length === 0) {
        selectedIndex = 0;
      } else if (selectedIndex >= safeItems.length) {
        selectedIndex = safeItems.length - 1;
      } else if (selectedIndex < 0) {
        selectedIndex = 0;
      }

      onMenuStateChange({
        open: true,
        items: safeItems,
        selectedIndex,
        query: activeProps.query,
        command: (item) => {
          activeProps?.command({
            id: item.id,
            label: item.label,
          });
        },
        position: (() => {
          const rect = activeProps.clientRect?.();
          if (!rect || typeof window === "undefined") {
            return null;
          }
          const viewportPadding = 8;
          const caretBottom = rect.top + Math.max(rect.height, 20);
          const left = Math.max(viewportPadding, rect.left);
          const top = Math.max(viewportPadding, caretBottom);
          return {
            top,
            left,
          };
        })(),
      });
    };

    return {
      onStart(props: SuggestionProps<ComposerMentionOption, MentionNodeAttrs>) {
        activeProps = props;
        selectedIndex = 0;
        publishMenu();
      },
      onUpdate(
        props: SuggestionProps<ComposerMentionOption, MentionNodeAttrs>,
      ) {
        activeProps = props;
        publishMenu();
      },
      onKeyDown(props: SuggestionKeyDownProps) {
        if (!activeProps) {
          return false;
        }

        if (props.event.key === "ArrowDown") {
          if (activeProps.items.length === 0) {
            return false;
          }
          props.event.preventDefault();
          selectedIndex = Math.min(
            selectedIndex + 1,
            activeProps.items.length - 1,
          );
          publishMenu();
          return true;
        }

        if (props.event.key === "ArrowUp") {
          if (activeProps.items.length === 0) {
            return false;
          }
          props.event.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, 0);
          publishMenu();
          return true;
        }

        if (props.event.key === "Enter") {
          if (activeProps.items.length === 0) {
            return false;
          }
          props.event.preventDefault();
          const selectedItem = activeProps.items[selectedIndex];
          if (selectedItem) {
            activeProps.command({
              id: selectedItem.id,
              label: selectedItem.label,
            });
          }
          return true;
        }

        if (props.event.key === "Escape") {
          props.event.preventDefault();
          closeMenu();
          return true;
        }

        return false;
      },
      onExit() {
        activeProps = null;
        closeMenu();
      },
    };
  },
});

export function AssistantComposerInput({
  value,
  placeholder,
  mentionOptions,
  onSearchMentions,
  onChange,
  onSubmit,
  onPasteFiles,
}: AssistantComposerInputProps) {
  const onSubmitRef = React.useRef(onSubmit);
  const emitChange = useCallbackRef(onChange);
  const getMentionOptions = useCallbackRef(() => mentionOptions);
  const getSearchMentionItems = useCallbackRef(() => onSearchMentions);
  const [mentionMenu, setMentionMenu] =
    React.useState<MentionMenuState>(CLOSED_MENTION_MENU);
  const mentionPopoverContentRef = React.useRef<HTMLDivElement | null>(null);
  const [mentionSearchPendingCount, setMentionSearchPendingCount] =
    React.useState(0);
  const isMentionSearching = mentionSearchPendingCount > 0;

  React.useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  React.useEffect(() => {
    if (!mentionMenu.open) {
      return;
    }
    const container = mentionPopoverContentRef.current;
    if (!container) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const selectedItem = container.querySelector<HTMLElement>(
        `[data-mention-index="${mentionMenu.selectedIndex}"]`,
      );
      selectedItem?.scrollIntoView({
        block: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [mentionMenu.open, mentionMenu.selectedIndex, mentionMenu.items.length]);

  const handleMentionSearchLoadingDelta = React.useCallback((delta: 1 | -1) => {
    setMentionSearchPendingCount((previous) => Math.max(0, previous + delta));
  }, []);

  const handleAsyncMentionItemsResolved = React.useCallback(
    ({ query, items }: { query: string; items: ComposerMentionOption[] }) => {
      setMentionMenu((previous) => {
        if (!previous.open || previous.query !== query) {
          return previous;
        }
        const nextItems = filterMentionOptions(items, query);
        const nextSelectedIndex =
          nextItems.length === 0
            ? 0
            : Math.min(previous.selectedIndex, nextItems.length - 1);
        return {
          ...previous,
          items: nextItems,
          selectedIndex: nextSelectedIndex,
        };
      });
    },
    [],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          code: false,
          heading: false,
          horizontalRule: false,
        }),
        Mention.configure({
          HTMLAttributes: {
            class:
              "inline-flex items-center whitespace-nowrap rounded-full border border-(--panel-border) bg-(--assistant-chip-bg) px-2 py-0.5 text-sm text-foreground",
          },
          renderText({ node }) {
            const mentionUrl =
              typeof node.attrs.id === "string" ? node.attrs.id.trim() : "";
            const mentionLabel =
              typeof node.attrs.label === "string"
                ? node.attrs.label.trim()
                : "";
            if (!mentionUrl) {
              return mentionLabel;
            }
            return formatMentionMarkdown(
              mentionLabel || mentionUrl,
              mentionUrl,
            );
          },
          renderHTML({ options, node }) {
            const mentionLabel =
              typeof node.attrs.label === "string" &&
              node.attrs.label.trim().length > 0
                ? node.attrs.label.trim()
                : typeof node.attrs.id === "string"
                  ? node.attrs.id
                  : "";

            return [
              "span",
              {
                ...options.HTMLAttributes,
                "data-mention-url":
                  typeof node.attrs.id === "string" ? node.attrs.id : "",
              },
              mentionLabel,
            ];
          },
          suggestion: createMentionSuggestion({
            getItems: getMentionOptions,
            getSearchItems: getSearchMentionItems,
            onLoadingDelta: handleMentionSearchLoadingDelta,
            onAsyncItemsResolved: handleAsyncMentionItemsResolved,
            onMenuStateChange: setMentionMenu,
          }),
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "rnc-composer-prosemirror min-h-12 sm:min-h-16 w-full px-0 py-0 leading-6 text-[16px] sm:text-sm text-foreground outline-none",
          "data-composer-input": "true",
          "aria-label": "Message",
        },
        handleKeyDown: (_, event) => {
          if (event.isComposing) {
            return false;
          }
          if (event.key !== "Enter" || event.shiftKey) {
            return false;
          }
          event.preventDefault();
          onSubmitRef.current();
          return true;
        },
      },
      onUpdate({ editor: nextEditor }) {
        const nextValue = normalizeComposerValue(
          nextEditor.getText({ blockSeparator: "\n" }),
        );
        emitChange(nextValue);
      },
    },
    [
      emitChange,
      getMentionOptions,
      getSearchMentionItems,
      handleAsyncMentionItemsResolved,
      handleMentionSearchLoadingDelta,
    ],
  );

  React.useEffect(() => {
    if (!editor) {
      return;
    }
    const normalizedEditorValue = normalizeComposerValue(
      editor.getText({ blockSeparator: "\n" }),
    );
    const normalizedIncomingValue = normalizeComposerValue(value);
    if (normalizedEditorValue === normalizedIncomingValue) {
      return;
    }

    editor.commands.setContent(
      buildPlainTextDocument(normalizedIncomingValue),
      {
        emitUpdate: false,
      },
    );
  }, [editor, value]);

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const pastedFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (pastedFiles.length === 0) {
        const pastedText = event.clipboardData.getData("text/plain");
        if (
          !editor ||
          !pastedText ||
          !MENTION_MARKDOWN_DETECT_PATTERN.test(pastedText)
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        editor
          .chain()
          .focus()
          .insertContent(buildPasteInsertContent(pastedText))
          .run();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onPasteFiles?.(pastedFiles);
    },
    [editor, onPasteFiles],
  );

  const groupedMentionItems = React.useMemo(
    () => groupMentionOptions(mentionMenu.items),
    [mentionMenu.items],
  );
  const selectedMentionValue = React.useMemo(() => {
    const selectedItem = mentionMenu.items[mentionMenu.selectedIndex];
    if (!selectedItem) {
      return "";
    }
    return `${selectedItem.category}:${selectedItem.id}`;
  }, [mentionMenu.items, mentionMenu.selectedIndex]);
  const isEditorEmpty = normalizeComposerValue(value).length === 0;

  return (
    <div className="relative">
      <EditorContent editor={editor} onPasteCapture={handlePaste} />
      {isEditorEmpty ? (
        <span className="pointer-events-none absolute left-0 top-0 select-none text-[16px] leading-6 text-[#7e8da7] sm:text-sm">
          {placeholder}
        </span>
      ) : null}
      <PopoverPrimitive.Root
        open={mentionMenu.open && Boolean(mentionMenu.position)}
        onOpenChange={(open) => {
          if (!open) {
            setMentionMenu(CLOSED_MENTION_MENU);
          }
        }}
        modal={false}
      >
        {mentionMenu.position ? (
          <PopoverPrimitive.Anchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed"
              style={{
                top: `${mentionMenu.position.top}px`,
                left: `${mentionMenu.position.left}px`,
                width: "1px",
                height: "1px",
              }}
            />
          </PopoverPrimitive.Anchor>
        ) : null}
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={mentionPopoverContentRef}
            side="bottom"
            align="start"
            sideOffset={12}
            className="z-[120] w-[min(26rem,calc(100vw-1rem))] rounded-xl border border-(--panel-border) bg-(--assistant-panel-bg) p-1 shadow-[0_14px_30px_rgba(15,23,42,0.14)] outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
            onEscapeKeyDown={() => {
              setMentionMenu(CLOSED_MENTION_MENU);
            }}
          >
            <Command value={selectedMentionValue} shouldFilter={false}>
              <CommandList className="max-h-72 overflow-y-auto">
                {isMentionSearching && (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-(--muted-foreground)">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Searching documents...</span>
                  </div>
                )}
                {mentionMenu.items.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-(--muted-foreground)">
                    No matches
                  </div>
                ) : (
                  MENTION_CATEGORY_ORDER.map((category) => {
                    const categoryItems = groupedMentionItems.get(category);
                    if (!categoryItems || categoryItems.length === 0) {
                      return null;
                    }
                    console.log("categoryItems", categoryItems);

                    return (
                      <CommandGroup
                        key={category}
                        heading={MENTION_CATEGORY_LABELS[category]}
                        className="p-0"
                      >
                        {categoryItems.map((item) => {
                          const optionIndex = mentionMenu.items.findIndex(
                            (candidate) => candidate.id === item.id,
                          );
                          const isActive =
                            optionIndex === mentionMenu.selectedIndex;
                          const itemValue = `${item.category}:${item.id}`;

                          return (
                            <CommandItem
                              key={itemValue}
                              value={itemValue}
                              data-mention-index={optionIndex}
                              className={cn(
                                "mx-1 mb-1 items-start gap-0 border border-transparent p-0",
                                "hover:border-(--panel-border) hover:bg-(--assistant-suggestion-hover)",
                                isActive &&
                                  "border-(--panel-border) bg-(--assistant-suggestion-hover)",
                              )}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                mentionMenu.command?.(item);
                              }}
                              onSelect={() => {
                                mentionMenu.command?.(item);
                              }}
                            >
                              <div className="flex w-full flex-col items-start px-2 py-1.5 text-left">
                                <span className="text-xs leading-4 text-foreground">
                                  {item.label}
                                </span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    );
                  })
                )}
              </CommandList>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <div className="pointer-events-none absolute inset-0 rounded-md ring-0 transition" />
    </div>
  );
}
