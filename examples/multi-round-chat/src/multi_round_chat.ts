import * as webllm from "@mlc-ai/web-llm";
import * as marked from "marked";

// Access our global functions from HTML
declare global {
  interface Window {
    webLLMGlobal: {
      addMessageToChat: (type: string, text: string) => HTMLElement;
      saveChatHistory: () => void;
      hideStatusBar: () => void;
      isGenerating: boolean;
      stopGeneration: boolean;
      toggleSendStopButton: (isGenerating: boolean) => void;
    };
  }
}

function setLabel(id: string, text: string) {
  const label = document.getElementById(id);
  if (label == null) {
    throw Error("Cannot find label " + id);
  }
  label.innerText = text;
}

// Use our enhanced markdown-enabled message function
function addMessage(role: string, content: string) {
  // Use the global function from HTML file for markdown support
  return window.webLLMGlobal.addMessageToChat(role, content);
}

function createStreamingMessage(role: string) {
  const chatContainer = document.getElementById("chat-container");
  if (!chatContainer) {
    throw Error("Chat container not found");
  }

  const messageContainer = document.createElement("div");
  messageContainer.className = "message-container";
  messageContainer.id = "streaming-container";

  const messageElement = document.createElement("div");
  messageElement.className = `message ${role}-message`;
  messageElement.textContent = "";

  // Store raw content for markdown parsing later
  messageElement.setAttribute("data-raw-content", "");

  messageContainer.appendChild(messageElement);
  chatContainer.appendChild(messageContainer);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  return messageElement;
}

function updateStreamingMessage(messageElement: HTMLElement, content: string) {
  // Store the raw content for localStorage
  messageElement.setAttribute("data-raw-content", content);

  // Configure marked for proper markdown rendering
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  // Parse markdown
  try {
    messageElement.innerHTML = marked.parse(content) as string;
  } catch (e) {
    console.error("Markdown parsing error:", e);
    messageElement.textContent = content; // Fallback to plain text
  }

  const chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function showTypingIndicator() {
  const chatContainer = document.getElementById("chat-container");
  if (!chatContainer) return;

  const typingContainer = document.createElement("div");
  typingContainer.className = "message-container";
  typingContainer.id = "typing-indicator-container";

  const typingIndicator = document.createElement("div");
  typingIndicator.className = "message assistant-message typing-indicator";

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    typingIndicator.appendChild(dot);
  }

  typingContainer.appendChild(typingIndicator);
  chatContainer.appendChild(typingContainer);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator() {
  const typingContainer = document.getElementById("typing-indicator-container");
  if (typingContainer) {
    typingContainer.remove();
  }
}

// Convert chat history from localStorage to model-compatible format
function convertChatHistoryToMessages(): webllm.ChatCompletionMessageParam[] {
  const chatHistory = localStorage.getItem("private-chat-history");
  if (!chatHistory) {
    return [
      {
        role: "system",
        content:
          "You are a helpful, respectful and honest assistant. Be as happy as you can when speaking please.",
      },
    ];
  }

  try {
    const messages: webllm.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are a helpful, respectful and honest assistant. Be as happy as you can when speaking please.",
      },
    ];

    const historyItems = JSON.parse(chatHistory);

    historyItems.forEach((item) => {
      if (item.type === "user") {
        messages.push({ role: "user", content: item.content });
      } else if (item.type === "assistant") {
        messages.push({ role: "assistant", content: item.content });
      }
      // We ignore system messages from the UI for model context
    });

    return messages;
  } catch (error) {
    console.error("Error parsing chat history:", error);
    return [
      {
        role: "system",
        content:
          "You are a helpful, respectful and honest assistant. Be as happy as you can when speaking please.",
      },
    ];
  }
}

/**
 * Chat application with multi-round chat capability
 */
async function main() {
  // Hide any leftover "lazy-load" elements
  const container = document.getElementById("lazy-load-container");
  if (container) container.style.display = "none";

  const messageInput = document.getElementById(
    "message-input",
  ) as HTMLInputElement;
  const sendButton = document.getElementById(
    "send-button",
  ) as HTMLButtonElement;
  const loadingIcon = document.getElementById("loading-icon") as HTMLElement;
  const sendIcon = document.getElementById("send-icon") as HTMLElement;
  const stopIcon = document.getElementById("stop-icon") as HTMLElement;
  const chatContainer = document.getElementById("chat-container");

  if (!messageInput || !sendButton || !chatContainer) {
    throw Error("Required UI elements not found");
  }

  // Show loading spinner, hide other icons
  if (loadingIcon) loadingIcon.classList.remove("hidden");
  if (sendIcon) sendIcon.classList.add("hidden");
  if (stopIcon) stopIcon.classList.add("hidden");
  sendButton.disabled = true;

  // Initialize model
  const initProgressCallback = (report: webllm.InitProgressReport) => {
    setLabel("init-label", report.text);
  };

  const selectedModel = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

  setLabel("init-label", `Loading model...`);

  try {
    window.webLLMGlobal.stopGeneration = false;

    // Load messages from chat history to use as context
    const messages = convertChatHistoryToMessages();

    const engine: webllm.MLCEngineInterface = await webllm.CreateMLCEngine(
      selectedModel,
      { initProgressCallback: initProgressCallback },
    );

    setLabel("init-label", `Model ${selectedModel} loaded successfully!`);
    // Once loaded, hide spinner, show send icon, enable button
    if (loadingIcon) loadingIcon.classList.add("hidden");
    if (sendIcon) sendIcon.classList.remove("hidden");
    sendButton.disabled = false;

    // Hide status bar after model is loaded
    window.webLLMGlobal.hideStatusBar();

    // Handle sending messages
    const handleSendMessage = async () => {
      const userInput = messageInput.value.trim();
      if (!userInput) return;

      // If we're already generating, this click means "stop"
      if (window.webLLMGlobal.isGenerating) {
        window.webLLMGlobal.stopGeneration = true;
        return;
      }

      // Clear input
      messageInput.value = "";

      // Display user message with markdown support
      addMessage("user", userInput);

      // Add user message to history
      messages.push({ role: "user", content: userInput });

      // Switch to stop icon
      if (sendIcon) sendIcon.classList.add("hidden");
      if (stopIcon) stopIcon.classList.remove("hidden");
      window.webLLMGlobal.toggleSendStopButton(true);

      // Remove typing indicator if it exists
      removeTypingIndicator();

      try {
        // Send request to model with streaming enabled
        const request: webllm.ChatCompletionRequest = {
          stream: true,
          messages: messages,
        };

        // Create the message element that will be updated as responses stream in
        const messageElement = createStreamingMessage("assistant");

        // Stream the response
        const asyncChunkGenerator =
          await engine.chat.completions.create(request);
        let fullResponse = "";

        for await (const chunk of asyncChunkGenerator) {
          // Check if stop button was clicked
          if (window.webLLMGlobal.stopGeneration) {
            window.webLLMGlobal.stopGeneration = false;
            break;
          }

          const content = chunk.choices[0]?.delta?.content || "";
          fullResponse += content;
          updateStreamingMessage(messageElement, fullResponse);

          if (chunk.usage) {
            console.log(`Token usage: ${JSON.stringify(chunk.usage)}`);
          }
        }

        // Add assistant response to message history
        messages.push({ role: "assistant", content: fullResponse });

        // Save to localStorage after each exchange
        window.webLLMGlobal.saveChatHistory();
      } catch (error) {
        addMessage(
          "system",
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error(error);
      } finally {
        // Switch back to send icon
        if (stopIcon) stopIcon.classList.add("hidden");
        if (sendIcon) sendIcon.classList.remove("hidden");
        window.webLLMGlobal.toggleSendStopButton(false);
      }
    };

    // Set up event listeners
    sendButton.addEventListener("click", handleSendMessage);

    messageInput.addEventListener("keypress", (e) => {
      if (
        e.key === "Enter" &&
        !window.webLLMGlobal.isGenerating &&
        !sendButton.disabled
      ) {
        handleSendMessage();
      }
    });

    // Focus input field
    messageInput.focus();
  } catch (error) {
    setLabel(
      "init-label",
      `Error initializing model: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  main().catch((error) => {
    console.error(error);
    const label = document.getElementById("init-label");
    if (label) label.textContent = "Error loading model.";
  });
});
