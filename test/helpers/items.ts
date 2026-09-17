import {vi} from "vitest";
import type {Comment, Post} from "@devvit/web/server";

export function makePost(overrides: Record<string, unknown> = {}): Post {
    return {
        id: "t3_post1",
        authorId: "t2_author1",
        authorName: "alice",
        authorFlair: {text: "Trusted", templateId: "user-flair"},
        title: "A post",
        body: "Post body",
        flair: {text: "News", templateId: "post-flair"},
        permalink: "/r/test/comments/post1/title/",
        score: 10,
        createdAt: new Date("2026-09-17T12:00:00Z"),
        numberOfReports: 0,
        userReportReasons: [],
        modReportReasons: [],
        removed: false,
        spam: false,
        getAuthor: vi.fn().mockResolvedValue({
            username: "alice",
            url: "https://www.reddit.com/user/alice",
        }),
        ...overrides,
    } as unknown as Post;
}

export function makeComment(overrides: Record<string, unknown> = {}): Comment {
    return {
        id: "t1_comment1",
        parentId: "t3_post1",
        postId: "t3_post1",
        authorId: "t2_author1",
        authorName: "alice",
        authorFlair: {text: "Trusted", templateId: "user-flair"},
        body: "Comment body",
        permalink: "/r/test/comments/post1/title/comment1/",
        createdAt: new Date("2026-09-17T12:00:00Z"),
        numReports: 0,
        userReportReasons: [],
        modReportReasons: [],
        removed: false,
        spam: false,
        getAuthor: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as Comment;
}
