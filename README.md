# Discord Relay

Discord Relay is an app that allows subreddit moderators to relay items from their subreddit to Discord or Slack
channels. This is useful for subreddits that want to keep their chat channels up-to-date with the latest content and
moderation activity from their subreddit. This also can be used to relay a specific user's posts and/or comments to a
webhook destination.

## Usage

Discord Relay runs when supported subreddit events are created or received. The original post/comment relay still runs
after Reddit's safety checks unless `Skip Reddit Safety Checks` under `Safety and Embeds` is enabled. Reported content,
modmail, and modlog forwarding run from Devvit triggers, and modqueue forwarding runs from a scheduled scan.

The only time you need to interact with it is during the setup process. To set up and configure Discord Relay, navigate
to the settings page on your subreddit:
`https://developers.reddit.com/r/SUBREDDIT/apps/discord-relay`.

Configure one or more destination webhook URLs, then select which event buckets each destination receives. Empty webhook
URL fields are allowed and ignored, so unused destination slots do not need to be filled in.

## Configuration

The bold names below match the labels displayed in the app settings. Settings are listed in the same group order as
`devvit.json`.

- **Webhook Destinations**: Configure up to six Discord or Slack webhook destinations and select the events sent to each
  one.
    - **Destination 1**, **Destination 2**, **Destination 3**, **Destination 4**, **Destination 5**, and
      **Destination 6** each contain:
        - **Enabled**: Turns the destination slot on or off without deleting its configuration.
        - **Webhook URL**: Optional Discord or Slack incoming webhook URL. Empty slots are ignored. Slack URLs beginning
          with `https://hooks.slack.com/services/` receive Slack payloads; other URLs receive Discord payloads.
        - **Event Types**: Select `All`, `Posts`, `Comments`, `Modlog`, `Modmail`, `Modqueue`, `Reported`, or
          `Unmoderated`.
    - **Legacy Unmoderated Destination**: Backward-compatible fallback for unmoderated items when no enabled numbered
      destination matches the item.
        - **Webhook URL**: Optional legacy webhook used only for that fallback.
- **Unmoderated Relay**: Control how unmoderated posts and comments are selected and relayed.
    - **Relay Behavior**: Choose when eligible content is processed.
        - **Enabled**: Turns unmoderated post and comment forwarding on or off.
        - **Relay Mode**: `Immediately` uses content triggers. `Front Page` scans up to 100 top posts once per minute
          and does not relay comments. Configured delays apply in either mode.
        - **Front Page Time Frame**: Stores the selected top-post time frame for Front Page mode. The current scanner
          does not yet apply this value.
    - **Discord Role Ping**: Optionally append a Discord role mention to unmoderated relays.
        - **Ping Discord Role**: Enables the role mention for Discord destinations.
        - **Discord Role ID**: Numeric Discord role ID. Enable Developer Mode in Discord, right-click the role, and
          select "Copy ID".
    - **Included Content**: `Content Type` and `Only Approved Authors` are required checks. When username, flair text,
      or flair template ID filters are configured, matching any one of those filters includes the item.
        - **Content Type**: Select `All`, `Posts Only`, or `Comments Only`.
        - **Username(s)/Moderators Only**: Comma-separated usernames without `u/`; use `m` to match all moderators.
        - **User Flair Text**: Comma-separated case-insensitive exact user-flair matches.
        - **User Flair Template ID**: Comma-separated template ID matches.
        - **Post Flair Text**: Comma-separated case-insensitive exact post-flair matches; applies only to posts.
        - **Post Flair Template ID**: Comma-separated template ID matches; applies only to posts.
        - **Only Approved Authors**: Requires the author to be in the subreddit's approved-user list.
    - **Excluded Content**: Matching any configured username, flair text, flair template ID, or author-status exclusion
      blocks an item even when an inclusion filter matches.
        - **Ignore Username(s)/Moderators**: Comma-separated usernames without `u/`; use `m` for all moderators.
        - **Ignore User Flair Text**: Comma-separated case-insensitive exact user-flair exclusions.
        - **Ignore User Flair Template ID**: Comma-separated template ID exclusions.
        - **Ignore Post Flair Text**: Comma-separated case-insensitive exact post-flair exclusions; applies only to
          posts.
        - **Ignore Post Flair Template ID**: Comma-separated template ID exclusions; applies only to posts.
        - **Ignore Shadowbanned or Deleted Authors**: Skips content whose author cannot be resolved.
    - **Timing and Approval**: A delay of `0` is disabled; nonzero delays must be at least three minutes.
        - **Comment Delay Minutes**: Delay before relaying an eligible comment.
        - **Post Delay Minutes**: Delay before relaying an eligible post.
        - **Ignore Removed Items**: Skips an item if it has been removed when the relay runs.
        - **Retry On Approval**: Retries an eligible item when a moderator later approves it.
        - **Comment Delay After Approval Minutes**: Delay applied to an approved-comment retry.
        - **Post Delay After Approval Minutes**: Delay applied to an approved-post retry.
        - **Post Score Threshold**: Checks a minimum score for Front Page posts. A matching username or flair inclusion
          currently takes precedence over this threshold.
    - **Safety and Embeds**: Configure trigger timing and Discord link-preview controls for unmoderated relays. Current
      payload normalization does not yet preserve either suppression setting.
        - **Skip Reddit Safety Checks**: Uses submit events instead of waiting for Reddit's create events.
        - **Suppress Item Embed**: Requests suppression of the relayed item link preview.
        - **Suppress Author Embed**: Requests suppression of the author profile link preview.
- **Modmail Relay**: Forward modmail messages. Modmail actions are not forwarded.
    - **Enabled**: Turns modmail forwarding on or off.
    - **Forward Scenario**: Select `Only New Threads`, `All Non-Mod Replies`, or `All Messages`.
- **Modqueue Relay**: Scan the full modqueue once per minute. Every configured filter category must pass; within a
  comma-separated keyword field, matching any case-insensitive substring passes that field.
    - **Enabled**: Turns scheduled modqueue scans on or off.
    - **Content Type**: Select `All`, `Posts`, or `Comments`.
    - **Minimum Report Count**: Required total report count; `0` disables this minimum.
    - **Minimum Age Minutes**: Youngest allowed item age; `0` disables this minimum.
    - **Maximum Age Minutes**: Oldest allowed item age; `0` disables this maximum.
    - **Report Contains**: Comma-separated case-insensitive substrings matched against report reasons.
    - **Post/Comment Body or Title Contains**: Comma-separated case-insensitive substrings matched against item text.
    - **Only Forward Mod Reported Items**: Requires at least one moderator report.
- **Reported Content Relay**: Forward post and comment report events as they arrive.
    - **Enabled**: Turns reported-content forwarding on or off.
    - **Report Type**: Select `All`, `Mod Report Only`, or `User Reports Only`.
    - **Minimum Report Count**: Required total report count; `0` disables this minimum.
    - **Mod Reports Bypass Minimum Count**: Lets a moderator report bypass only the minimum-count requirement.
- **Modlog Relay**: Forward moderation-action events.
    - **Enabled**: Turns modlog forwarding on or off.
    - **Actions to Forward**: Select `All` or specific moderation actions.

## Development

Run `npm test` to execute the test suite, or `npm run test:coverage` to collect coverage for all TypeScript source files,
including files without tests. Coverage is printed in the terminal and saved to `coverage/index.html` (HTML) and
`coverage/lcov.info` (LCOV). Generated reports are ignored by Git.

## Known Issues

- Items removed by u/AutoModerator may still be relayed to Discord or Slack. There is not a way to determine if an item
  was removed by u/AutoModerator at this time.

## Feedback

If you have any feedback or suggestions for Discord Relay, file a bug report or feature request on the
[GitHub page](https://github.com/LilSpazJoekp/discord-relay).

## Changes

### 3.0.0

- Added Slack webhook support.
- Added up to six optional webhook destinations, each with enable/disable and event-type routing controls.
- Added configurable forwarding for reported content, modqueue items, modmail messages, and modlog actions.
- Added user and post flair template ID filters alongside the existing flair text filters.
- Reorganized the existing post and comment settings under `Unmoderated Relay` and added an enable control while
  preserving existing setting keys and the legacy webhook fallback.

## 2.6.2

- Fix bug where duplicate events were being relayed.

### 2.6.1

- Fix bug where specifying an inclusion filter would not work.
- Fix shadowbanned check due to Devvit change.

### 2.5.0

- Added the ability to introduce a delay before relaying comments and/or posts to Discord after approval.

### 2.4.1

- Fix shadowbanned check to actually test the author instead of the test author.

### 2.4.0

- Added the ability to only relay items of approved users.
- Added the ability to skip Reddit safety checks.
- Added the ability to ignore items by shadowbanned or deleted authors.

### 2.3.1

- Update devvit version for vulnerability fix.

### 2.3.0

- Added the ability to only relay posts that hit the front page of the subreddit.
- Added the ability to suppress embeds for the item and author links in Discord.

### 2.2.3

- Fix bug when posts are submitted.

### 2.2.0

- Added the ability to add a delay before relaying items to Discord.
- Added the ability to ignore removed items.
- Added the ability to retry relaying items that were removed and not relayed after the delay.

### 2.1.1

- Added the ability to white/blacklist by username, moderator status, and user/post flair.

### 2.0.3

- Fix issues where items were being relayed multiple times.

### 2.0.2

- Added support allow multiple users and moderators to be specified.

### 1.0.0

- Initial release.
