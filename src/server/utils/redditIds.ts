import {T1, T2, T3} from "@devvit/web/shared";

export function toCommentId(id: string) {
    return T1(id.startsWith("t1_") ? id : `t1_${id}`);
}

export function toPostId(id: string) {
    return T3(id.startsWith("t3_") ? id : `t3_${id}`);
}

export function toUserId(id: string) {
    return T2(id.startsWith("t2_") ? id : `t2_${id}`);
}
