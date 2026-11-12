package dev.monocalendar.rp1;
import java.util.Arrays;

/** Regression for partly-cloudy icons that used to look identical to overcast. */
public class WeatherCheck {
    public static void main(String[] args) {
        assert !Arrays.equals(Page.weatherIcon("partlycloudy", false), Page.weatherIcon("cloudy", false));
        assert !Arrays.equals(Page.weatherIcon("partlycloudy", false), Page.weatherIcon("partlycloudy", true));
        assert Arrays.equals(Page.weatherIcon("sunny", true), Page.weatherIcon("clear-night", true));
        assert Page.nightAt("03:00", "07:04", "17:18");
        assert !Page.nightAt("07:04", "07:04", "17:18");
        assert !Page.nightAt("12:00", "07:04", "17:18");
        assert Page.nightAt("17:18", "07:04", "17:18");
        assert !Page.nightAt("03:00", null, null);
        assert Page.conditionName("partlycloudy").equals("晴间多云");
        System.out.println(
            "Weather icons distinguish clear/partly-cloudy/overcast, with local sunrise/sunset day-night boundaries.");
    }
}
