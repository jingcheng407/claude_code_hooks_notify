# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code Hook notification system that sends intelligent notifications to Lark/Feishu and Telegram when Claude Code sessions end. It features smart conversation summarization, duration-based filtering, and daily cost tracking.

## Architecture

The system consists of four core components:

1. **send_smart_notification.sh** - Main hook script that integrates with Claude Code's Stop event
2. **generate_summary.py** - Parses Claude Code JSONL transcript files to extract conversation summaries, tool usage, and session duration
3. **telegram_bridge.py** - Simplified one-way Telegram message sender
4. **launcher scripts** - Control scripts that set appropriate environment variables

## Key Features

### Duration Filtering
- Only conversations lasting >60 seconds trigger notifications
- Filters out short test sessions and brief interactions
- Parses Chinese duration formats ("2分30秒", "45秒") into total seconds
- Manual triggers (without duration data) always send notifications

### Notification Channels
- **Primary**: Lark/Feishu webhooks with rich formatting
- **Secondary**: Telegram one-way push notifications
- **Modes**: Lark-only, Telegram-only, or dual-channel

### Smart Summarization  
- Extracts latest user request (truncated to 50 chars)
- Lists assistant tool usage (Read, Edit, Bash, etc.)
- Calculates session duration from first user message to last assistant response
- Handles multimedia messages (images + text)

## Configuration System

Template-based configuration in `config.template.sh` → `config.sh`:
- `WEBHOOK_URL` - Lark webhook endpoint
- `NOTIFICATION_LANG` - Must be "en" or "zh" (no bilingual mode)
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather  
- `TELEGRAM_CHAT_ID` - Target chat ID (simplified from previous user binding system)
- `TELEGRAM_MODE` - "off", "on" (dual), or "only"

Critical: `CC_HOOKS_NOTIFY` environment variable must be "on"/"enabled"/"true"/"1" to enable notifications.

## Data Flow

1. Claude Code Stop event → `send_smart_notification.sh`
2. Hook receives JSON with `transcript_path` to JSONL conversation log
3. `generate_summary.py` parses conversation data and calculates duration
4. **Duration check**: Skip if <60 seconds, proceed if ≥60 seconds or no duration data
5. Query `ccusage daily --json` for today's total cost (optional)
6. Construct language-specific message with summary, duration, cost, timestamp, directory
7. Send to configured endpoints (Lark webhook and/or Telegram API)

## Common Development Commands

Testing the notification system:
```bash
# Test short duration (should be skipped)
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Test short|||30秒"

# Test long duration (should be sent)  
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Test long|||2分30秒"

# Test manual trigger (always sent)
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Manual test"

# Check execution logs
tail -f logs/hook_execution.log

# Test telegram bridge directly
python3 telegram_bridge.py send "Test message"
```

Launch modes:
```bash
./claude-notify      # Lark notifications only
./claude-silent      # No notifications  
./claude-telegram     # Lark + Telegram
./claude-telegram-only # Telegram only
```

Setup commands:
```bash
# Set executable permissions
chmod +x *.sh claude-notify claude-silent claude-telegram*

# Create config from template
cp config.template.sh config.sh
# Edit config.sh to set WEBHOOK_URL, NOTIFICATION_LANG, and optional Telegram settings

# Create logs directory
mkdir -p logs

# Install optional cost tracking
npm install -g ccusage
```

## Integration Points

- **Claude Code Settings**: Hook registered in `~/.claude/settings.json` under `hooks.stop`
- **ccusage**: Optional CLI tool for cost tracking integration
- **Lark API**: Standard webhook format with `msg_type: "text"`
- **Telegram Bot API**: Simple sendMessage endpoint for one-way notifications
- **JSONL Format**: Handles Claude Code's conversation transcript with ISO 8601 timestamps

## Security & Safety

- Notifications disabled by default (safe defaults principle)
- `config.sh` is git-ignored to protect webhook URLs and tokens
- Duration filtering prevents spam from short test interactions
- No sensitive data logged in execution logs
- Simplified Telegram integration removes user binding complexity