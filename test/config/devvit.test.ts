import {readFileSync} from "node:fs";

import {describe, expect, it} from "vitest";

const config = JSON.parse(readFileSync(new URL("../../devvit.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

type SettingDefinition = {
    label: string;
    fields?: Record<string, SettingDefinition>;
};

function getSettingLabels(fields: Record<string, SettingDefinition>): string[] {
    return Object.values(fields).flatMap((field) => [
        field.label,
        ...(field.fields ? getSettingLabels(field.fields) : []),
    ]);
}

describe("devvit configuration", () => {
    it("documents the exact app setting labels in the README", () => {
        const configurationSection = readme
            .split("## Configuration\n", 2)[1]
            ?.split("\n## Known Issues", 1)[0] ?? "";
        const documentedLabels = [...configurationSection.matchAll(/\*\*([^*]+)\*\*/g)]
            .map((match) => match[1]);
        const settingLabels = getSettingLabels(config.settings.subreddit);

        expect([...new Set(documentedLabels)].sort()).toEqual([...new Set(settingLabels)].sort());
    });

    it("does not expose modmail action alerts", () => {
        expect(config.settings.subreddit["modmail-relay"].fields).not.toHaveProperty("modmail-include-actions");
    });

    it("includes the full old reddit modlog action list", () => {
        const options = config.settings.subreddit["modlog-relay"].fields["modlog-actions"].options;
        expect(options.map((option: { value: string }) => option.value)).toEqual([
            "all",
            "acceptmoderatorinvite",
            "add_community_topics",
            "addcontributor",
            "addmoderator",
            "addnote",
            "addremovalreason",
            "adjust_post_crowd_control_level",
            "approve_award",
            "approvecomment",
            "approvelink",
            "banuser",
            "chat_approve_message",
            "chat_ban_user",
            "chat_invite_host",
            "chat_remove_host",
            "chat_remove_message",
            "chat_unban_user",
            "collections",
            "community_status",
            "community_styling",
            "community_welcome_page",
            "community_widgets",
            "create_award",
            "create_scheduled_post",
            "createremovalreason",
            "createrule",
            "delete_award",
            "delete_scheduled_post",
            "deletenote",
            "deleteoverriddenclassification",
            "deleteremovalreason",
            "deleterule",
            "dev_platform_app_changed",
            "dev_platform_app_disabled",
            "dev_platform_app_enabled",
            "dev_platform_app_installed",
            "dev_platform_app_uninstalled",
            "disable_award",
            "disable_post_crowd_control_filter",
            "distinguish",
            "edit_comment_requirements",
            "edit_post_requirements",
            "edit_saved_response",
            "edit_scheduled_post",
            "editflair",
            "editrule",
            "editsettings",
            "enable_award",
            "enable_post_crowd_control_filter",
            "events",
            "hidden_award",
            "ignorereports",
            "invitemoderator",
            "invitesubscriber",
            "lock",
            "marknsfw",
            "markoriginalcontent",
            "mod_award_given",
            "modmail_enrollment",
            "muteuser",
            "overrideclassification",
            "remove_community_topics",
            "removecomment",
            "removecontributor",
            "removelink",
            "removemoderator",
            "removewikicontributor",
            "reordermoderators",
            "reorderremovalreason",
            "reorderrules",
            "request_assistance",
            "setcontestmode",
            "setpermissions",
            "setsuggestedsort",
            "showcomment",
            "snoozereports",
            "spamcomment",
            "spamlink",
            "spoiler",
            "sticky",
            "submit_content_rating_survey",
            "submit_scheduled_post",
            "unbanuser",
            "unignorereports",
            "uninvitemoderator",
            "unlock",
            "unmuteuser",
            "unsetcontestmode",
            "unsnoozereports",
            "unspoiler",
            "unsticky",
            "updateremovalreason",
            "wikibanned",
            "wikicontributor",
            "wikipagelisted",
            "wikipermlevel",
            "wikirevise",
            "wikiunbanned",
        ]);
    });
});
