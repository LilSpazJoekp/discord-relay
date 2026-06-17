import {scheduler} from "@devvit/web/server";

import {FRONT_PAGE_CHECK_SCHEDULED_JOB} from "../constants.js";

export async function resetFrontPageScheduler() {
    const jobs = await scheduler.listJobs();
    await Promise.all(jobs
        .filter((job) => job.name === FRONT_PAGE_CHECK_SCHEDULED_JOB)
        .map(async (job) => await scheduler.cancelJob(job.id)));
    await scheduler.runJob({
        name: FRONT_PAGE_CHECK_SCHEDULED_JOB,
        cron: "* * * * *",
    });
}
