import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("@devvit/web/server", () => ({
    scheduler: {listJobs: vi.fn(), cancelJob: vi.fn(), runJob: vi.fn()},
}));

import {scheduler} from "@devvit/web/server";
import {resetSchedulers} from "../../src/server/services/frontPageScheduler.js";

describe("recurring scheduler setup", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(scheduler.listJobs).mockResolvedValue([]);
    });

    it("creates both minute scans on a fresh install", async () => {
        await resetSchedulers();

        expect(scheduler.runJob).toHaveBeenCalledTimes(2);
        expect(scheduler.runJob).toHaveBeenCalledWith({name: "check-front-page", cron: "* * * * *"});
        expect(scheduler.runJob).toHaveBeenCalledWith({name: "scan-modqueue", cron: "* * * * *"});
        expect(scheduler.cancelJob).not.toHaveBeenCalled();
    });

    it("replaces all old scans while preserving pending relay jobs", async () => {
        vi.mocked(scheduler.listJobs).mockResolvedValue([
            {id: "front-1", name: "check-front-page"},
            {id: "front-2", name: "check-front-page"},
            {id: "queue-1", name: "scan-modqueue"},
            {id: "relay-1", name: "relay"},
        ] as never);

        await resetSchedulers();

        expect(scheduler.cancelJob).toHaveBeenCalledTimes(3);
        for (const id of ["front-1", "front-2", "queue-1"]) {
            expect(scheduler.cancelJob).toHaveBeenCalledWith(id);
        }
        expect(scheduler.cancelJob).not.toHaveBeenCalledWith("relay-1");
        expect(scheduler.runJob).toHaveBeenCalledTimes(2);
    });

    it("does not add duplicate scans if cancellation fails", async () => {
        vi.mocked(scheduler.listJobs).mockResolvedValue([{id: "front-1", name: "check-front-page"}] as never);
        vi.mocked(scheduler.cancelJob).mockRejectedValue(new Error("Cannot cancel job"));

        await expect(resetSchedulers()).rejects.toThrow("Cannot cancel job");
        expect(scheduler.runJob).not.toHaveBeenCalled();
    });
});
