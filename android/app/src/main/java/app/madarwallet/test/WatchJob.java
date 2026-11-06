package app.madarwallet.test;

import android.app.job.JobParameters;
import android.app.job.JobService;

public class WatchJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { Watch.run(getApplicationContext()); } catch (Exception ignored) {  }
            finally { jobFinished(params, false); }
        }, "madar-watch").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
