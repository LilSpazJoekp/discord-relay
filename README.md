# Discord Relay

Discord Relay is an app that allows subreddit moderators to relay items from their subreddit to a Discord channel. This
is useful for subreddits that want to keep their Discord server up-to-date with the latest content from their subreddit.
This also can be used to relay a specific users' posts and/or comments to Discord.

## Usage

Discord Relay runs when a comment or post is created (after Reddit's safety checks). The only time you need to interact
with it is during the setup process. To set up and configure Discord Relay, navigate to the settings page on your
subreddit:`https://developers.reddit.com/r/SUBREDDIT/apps/discord-relay`.

## Configuration

- **Discord Webhook URL**: The URL of the Discord webhook you want to relay items to.
- **Relay Mode**: Determines when items are relayed to Discord. Both options will include the set delay
    - **Immediately**: Relay items as soon as they are created.
    - **Front Page**: Relay only items that hit the front page of the subreddit.
- **Role Ping settings**: The role to ping when a new item is relayed to Discord.
    - **Ping a role?**: If enabled, ping the role when a new item is relayed.
    - **Role ID**: The Discord ID of the role to ping. To obtain, enable Developer Mode in Discord, right-click the
      role, and click "Copy ID".
- **Content Type**: The type of content to relay to Discord.
    - **All**: Relay all items.
    - **Comments**: Relay only comments.
    - **Posts**: Relay only posts.
- **Filter Settings**: Settings to determine which items are relayed to Discord.
    - **Inclusion Filters**
        - **Username(s)/Moderators Only**: Only relay items from specific users or moderators. Username (without the "
          u/") or enter "m" for all moderators. Separate each item with a comma to include multiple users.
        - **User Flair Text**: User flair text to match against. Separate each item with a comma to include multiple
          flairs.
        - **Post Flair Text**: Post flair text to match against. Separate each item with a comma to include multiple
          flairs.
        - **Only Approved Authors**: If enabled, only authors that are also 'Approved Users' can relay. This list is
          located at `https://www.reddit.com/r/SUBREDDIT/about/contributors`.
    - **Exclusion Filters**
        - **Username(s)/Moderators Only**: Ignore items from specific users or moderators. Username (without the "u/")
          or enter "m" for all moderators. Separate each item with a comma to include multiple users.
        - **User Flair Text**: User flair text to ignore. Separate each item with a comma to include multiple flairs.
        - **Post Flair Text**: Post flair text to ignore. Separate each item with a comma to include multiple flairs.
        - **Ignore Shadowbanned or Deleted Authors**: If enabled, authors that deleted their account or is shadowbanned
          will not be relayed.
- **Delay Settings**: Settings to determine how long to wait before relaying items to Discord. Note: The minimum delay
  is 3 minutes and can be delayed by 1-2 minutes due to Developer Platform limitations.
    - **Comment Delay**: Number of minutes to delay relaying comments to Discord. Enter 0 to disable the delay. Must be
      at least 3 minutes.
    - **Post Delay**: Number of minutes to delay relaying posts to Discord. Enter 0 to disable the delay. Must be at
      least 3 minutes.
    - **Ignore Removed Items**: If enabled, do not relay items that have been removed.
    - **Retry On Approval**: If enabled, retry relaying items that were removed and not relayed after the delay.
    - **Comment Delay After Approval**: Number of minutes to delay relaying comments to Discord after approval. This is useful to allow
      Discord to correctly render the embed. Enter 0 to disable the delay. Must be at least 3 minutes.
    - **Post Delay After Approval**: Number of minutes to delay relaying posts to Discord after approval. This is useful to allow
      Discord to correctly render the embed. Enter 0 to disable the delay. Must be at least 3 minutes.
    - **Ignore Safety Checks**: If enabled, skip built-in Reddit safety checks and relay the item to Discord. Useful for
      moderation feeds.
- **Suppress Item Embed**: If enabled, the embed of the comment/post like being relayed will be suppressed.
- **Suppress Author Embed**: If enabled, the embed of the author will be suppressed. Profiles do not have embeds shown
  unless they are NSFW.

## Known Issues

- Items removed by u/AutoModerator may still be relayed to Discord. There is not a way to determine if an item was
  removed by u/AutoModerator at this time.

## Feedback

If you have any feedback or suggestions for Discord Relay, file a bug report or feature request on the
[GitHub page](https://github.com/LilSpazJoekp/discord-relay).

## Changes

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
