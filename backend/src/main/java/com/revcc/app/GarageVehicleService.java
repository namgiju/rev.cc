package com.revcc.app;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;

@Service
@Transactional(readOnly = true)
public class GarageVehicleService {
    private final GarageVehicleRepository vehicles;
    private final UserRepository users;

    public GarageVehicleService(GarageVehicleRepository vehicles, UserRepository users) {
        this.vehicles = vehicles;
        this.users = users;
    }

    public List<GarageVehicleResponse> mine(Long userId) {
        return vehicles.findByUserIdOrderByIdDesc(userId).stream().map(GarageVehicleResponse::from).toList();
    }

    public GarageVehicleResponse profile(Integer id) { return GarageVehicleResponse.from(find(id)); }

    @Transactional
    public GarageVehicleResponse create(Long userId, GarageVehicleRequest request) {
        User user = users.findById(userId).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요."));
        return GarageVehicleResponse.from(vehicles.saveAndFlush(new Vehicle(user, request)));
    }

    @Transactional
    public GarageVehicleResponse update(Integer id, Long userId, GarageVehicleRequest request) {
        Vehicle vehicle = owned(id, userId);
        vehicle.update(request);
        return GarageVehicleResponse.from(vehicles.saveAndFlush(vehicle));
    }

    @Transactional
    public void delete(Integer id, Long userId) { vehicles.delete(owned(id, userId)); }

    private Vehicle find(Integer id) {
        return vehicles.findById(id).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.NOT_FOUND, "차량을 찾을 수 없습니다."));
    }

    private Vehicle owned(Integer id, Long userId) {
        Vehicle vehicle = find(id);
        if (!vehicle.getUser().getId().equals(userId))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인 차량만 변경할 수 있습니다.");
        return vehicle;
    }
}
