import dev.monocalendar.rp1.*;
import java.io.FileInputStream;
import java.nio.file.*;
import java.util.*;

/**
 * Offline calendar and optimistic-write checks (run with -ea). Expected values come from the design and the 6tail
 * library.
 */
public class AlmanacCheck {
    public static void main(String[] args) throws Exception {
        Path root = Paths.get(System.getProperty("project", "."));
        Almanac almanac = new Almanac(new FileInputStream(root.resolve("android/assets/almanac.bin").toFile()),
            new FileInputStream(root.resolve("android/assets/almanac-lists.txt").toFile()));
        Almanac.Day day = almanac.day(2026, 11, 6);
        assert day.known && day.lunarText().equals("九月廿八") : day.lunarText();
        assert day.ganzhi().equals("丙午年 戊戌月 甲申日") : day.ganzhi();
        assert day.meta().equals("开日 冲虎 煞南") : day.meta();
        assert day.yi.equals("嫁娶 订盟 纳采 祭祀 祈福 出行 求医 治病 出火 移徙 入宅") : day.yi;
        assert day.ji.equals("开市 开仓 出货财 安床 安门 安葬") : day.ji;
        assert day.weekday() == 5 && day.isoWeek() == 45;
        assert almanac.day(2026, 11, 7).label.equals("立冬") && almanac.day(2026, 11, 7).strong;
        assert almanac.day(2026, 11, 9).label.equals("十月") : "lunar first day shows the month";
        assert almanac.day(2026, 11, 26).label.equals("感恩节");
        assert almanac.day(2026, 10, 31).label.equals("万圣夜");
        assert almanac.day(2027, 2, 5).label.equals("除夕") && almanac.day(2027, 2, 6).label.equals("春节");
        assert almanac.day(2025, 7, 26).lunarText().startsWith("闰六月") : almanac.day(2025, 7, 26).lunarText();
        assert almanac.day(2026, 12, 28).isoWeek() == 53 && almanac.day(2027, 1, 4).isoWeek() == 1;
        List<Almanac.Upcoming> upcoming = almanac.upcoming(Almanac.epochDay(2026, 11, 6), 5);
        assert upcoming.size() == 5;
        assert upcoming.get(0).name.equals("立冬") && upcoming.get(0).daysAhead == 1;
        assert upcoming.get(0).day.epoch == Almanac.epochDay(2026, 11, 7);
        assert upcoming.get(2).name.equals("感恩节") && upcoming.get(2).daysAhead == 20;
        assert !almanac.day(1900, 12, 31).known && almanac.day(1901, 1, 1).known && almanac.day(2099, 12, 31).known
            && !almanac.day(2100, 1, 1).known;
        for (long e = Almanac.epochDay(1901, 1, 1); e <= Almanac.epochDay(2099, 12, 31); e += 37) {
            int[] c = Almanac.civil(e);
            assert Almanac.epochDay(c[0], c[1], c[2]) == e;
        }

        Object data = Json.parse("{\"devices\":[{\"id\":\"fan\",\"on\":false},{\"id\":\"desk_light\",\"on\":true}],"
            + "\"ac\":{\"mode\":\"heat\",\"target\":30.0,\"low\":16.0,\"high\":18.0}}");
        Optimistic.apply(data, "device:fan:on");
        Object fan = Json.list(data, "devices").get(0);
        assert Json.bool(fan, "on") && Json.num(fan, "minutes") == 15;
        Object configuredDevices = Json.parse("{\"devices\":[{\"id\":\"ventilation\",\"type\":\"nest_fan\",\"on\":false},"
            + "{\"id\":\"fan\",\"type\":\"toggle\",\"on\":false}]}");
        Optimistic.apply(configuredDevices, "device:ventilation:on");
        assert Json.num(Json.list(configuredDevices, "devices").get(0), "minutes") == 15
            : "a configured Nest fan keeps its timer under a custom id";
        Optimistic.apply(configuredDevices, "device:ventilation:off");
        assert Json.num(Json.list(configuredDevices, "devices").get(0), "minutes") == null;
        Optimistic.apply(configuredDevices, "device:fan:on");
        assert Json.bool(Json.list(configuredDevices, "devices").get(1), "on")
            && Json.num(Json.list(configuredDevices, "devices").get(1), "minutes") == null
            : "a plain fan toggle is not assigned a Nest timer by its id";
        Optimistic.apply(data, "device:desk_light:off");
        assert !Json.bool(Json.list(data, "devices").get(1), "on");
        Optimistic.apply(data, "device:desk_light:off");
        assert !Json.bool(Json.list(data, "devices").get(1), "on") : "repeating a target state never flips it";
        Optimistic.apply(data, "temp_up");
        assert Json.num(Json.obj(data, "ac"), "target") == 30 : "setpoint capped at 30";
        assert Optimistic.wire(data, "temp_up")
            .equals("temp:heat:30.0")
            : "send the displayed target and mode, not another increment";
        Optimistic.apply(data, "range_low_up");
        assert Json.num(Json.obj(data, "ac"), "low") == 16 : "Nest needs a 2 degree gap on the half-degree grid";
        assert Optimistic.wire(data, "range_low_up").equals("range:16.0:18.0");
        Optimistic.apply(data, "mode:cool");
        assert "cool".equals(Json.str(Json.obj(data, "ac"), "mode"));
        Object bounded = Json.parse("{\"ac\":{\"mode\":\"heat\",\"target\":10.0,\"min\":10.0,\"max\":28.0}}");
        Optimistic.apply(bounded, "temp_down");
        assert Json.num(Json.obj(bounded, "ac"), "target") == 10 : "honor the device minimum";
        Json.obj(bounded, "ac").put("target", 28.0);
        Optimistic.apply(bounded, "temp_up");
        assert Json.num(Json.obj(bounded, "ac"), "target") == 28;
        System.out.println(
            "Almanac (lunar, ganzhi, yi/ji, terms, festivals, ISO weeks, range) and optimistic writes passed.");
    }
}
