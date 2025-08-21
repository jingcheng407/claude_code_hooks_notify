# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Claude Code Hook notification system that sends intelligent Lark/Feishu notifications when Claude Code sessions end. It integrates conversation summarization, duration tracking, and daily cost reporting.

## Architecture

The system consists of four core components:

1. **send_smart_notification.sh** - Main hook script that integrates with Claude Code's Stop event
2. **generate_summary.py** - Parses Claude Code JSONL transcript files to extract conversation summaries, tool usage, and duration
3. **config.sh** - Configuration file (user-created from template) containing webhook URL and language settings
4. **claude-notify/claude-silent** - Launcher scripts that control the CC_HOOKS_NOTIFY environment variable

## Configuration System

The system uses a template-based configuration approach:
- `config.template.sh` contains the template with placeholder values
- Users copy this to `config.sh` and fill in their actual webhook URL and language preference
- `config.sh` is git-ignored to protect sensitive webhook URLs

Critical environment variable: `CC_HOOKS_NOTIFY` must be set to "on"/"ON"/"enabled"/"true"/"1" to enable notifications (disabled by default for security).

## Data Flow

1. Claude Code triggers Stop hook → calls `send_smart_notification.sh`
2. Hook receives JSON with `transcript_path` pointing to JSONL conversation log
3. `generate_summary.py` parses JSONL to extract:
   - Latest user request (truncated to 50 chars)
   - Assistant tool usage (Read, Edit, Bash, etc.)
   - Session duration (from first user message to last assistant response)
4. Hook queries `ccusage daily --json` for today's total cost across all projects
5. Constructs language-specific Lark message with summary, duration, cost, timestamp, directory
6. Sends HTTP POST to configured webhook URL

## Key Integration Points

- **Claude Code Settings**: Hook must be registered in `~/.claude/settings.json` under `hooks.stop`
- **ccusage**: Optional dependency for cost tracking via `npm install -g ccusage`
- **Lark API**: Uses webhook format with `msg_type: "text"` and specific content structure
- **JSONL Parsing**: Handles Claude Code's conversation transcript format with ISO 8601 timestamps

## Common Commands

Testing the notification system:
```bash
# Enable notifications and test
export CC_HOOKS_NOTIFY=on
echo "test message" | ./send_smart_notification.sh

# Use launcher scripts
./claude-notify  # Starts Claude with notifications enabled
./claude-silent  # Starts Claude with notifications disabled

# Check logs
tail -f logs/hook_execution.log

# Test with custom message
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Custom test message"
```

Setup commands:
```bash
# Set executable permissions
chmod +x *.sh claude-notify claude-silent

# Create config from template
cp config.template.sh config.sh
# Edit config.sh to set WEBHOOK_URL and NOTIFICATION_LANG

# Create logs directory
mkdir -p logs
```

## Language Configuration

The system requires explicit language selection in config.sh:
- `NOTIFICATION_LANG="en"` - English notifications with "Today's Total" cost display  
- `NOTIFICATION_LANG="zh"` - Chinese notifications with "今日累计" cost display

No bilingual mode - language must be explicitly chosen to avoid confusion.

## Security Notes

- config.sh contains webhook URLs and is git-ignored
- Notifications are disabled by default (safe defaults principle)
- Hook validates CC_HOOKS_NOTIFY environment variable before executing
- Webhook URLs should be kept private and not committed to version control