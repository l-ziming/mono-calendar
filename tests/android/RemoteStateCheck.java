import dev.monocalendar.rp1.Json;
import dev.monocalendar.rp1.RemoteState;

public class RemoteStateCheck {
    public static void main(String[] args) {
        RemoteState state = new RemoteState();
        long previousReadId = state.beginRead();
        assert previousReadId != 0;
        assert state.beginRead() == 0 : "one quarter sync at a time";
        assert state.finishRead(previousReadId);
        long currentReadId = state.beginRead();
        assert currentReadId != 0 && currentReadId != previousReadId;
        assert !state.finishRead(previousReadId) : "a late callback/timeout cannot retire the newer request";
        assert state.finishRead(currentReadId);
        assert !state.finishRead(0);
        Object currentData = Json.parse("{\"dataTime\":2000}");
        assert RemoteState.canAcceptDataTime(currentData, 2000) && RemoteState.canAcceptDataTime(currentData, 2500);
        assert !RemoteState.canAcceptDataTime(currentData, 1999)
            : "an older document (server time) never replaces a newer one";
        assert RemoteState.canAcceptDataTime(Json.parse("{}"), 5) && RemoteState.canAcceptDataTime(currentData, 0);
        System.out.println("Remote read ordering: one sync at a time, stale callbacks and older documents rejected.");
    }
}
