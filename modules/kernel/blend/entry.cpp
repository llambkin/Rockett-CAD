#include <cmath>

namespace
{

constexpr int FILLET_INPUTS = 19;
constexpr int FILLET_OUTPUTS = 18;
constexpr int CHAMFER_INPUTS = 21;
constexpr int SIZE = CHAMFER_INPUTS + FILLET_OUTPUTS;
constexpr double ANGULAR = 1e-9;

double io[SIZE];

struct Vec {
    double x, y, z;
};

Vec operator+(Vec a, Vec b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec operator-(Vec a, Vec b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec operator*(double s, Vec a) { return {s * a.x, s * a.y, s * a.z}; }
double dot(Vec a, Vec b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

Vec read(int at) { return {io[at], io[at + 1], io[at + 2]}; }

void write(int at, Vec v)
{
    io[at] = v.x;
    io[at + 1] = v.y;
    io[at + 2] = v.z;
}

void require_finite(int count)
{
    for (int i = 0; i < count; i++) {
        if (!std::isfinite(io[i])) __builtin_trap();
    }
}

struct Side {
    Vec normal, into;
    double radius;
};

Vec cross(Vec a, Vec b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }

Vec chamfer_contact(Vec p, Side side, double distance)
{
    if (side.radius == 0) return p + distance * side.into;
    const double r = std::fabs(side.radius);
    const Vec c = p - side.radius * side.normal;
    const Vec u = (1 / r) * (p - c);
    const double theta = 2 * std::asin(distance / (2 * r));
    return c + r * (std::cos(theta) * u + std::sin(theta) * side.into);
}

struct Section {
    Vec centre, contact1, contact2;
};

int plane_section(Side a, Side b, double radius, Section& section)
{
    const double cosine = dot(a.normal, b.normal);
    if (1 + cosine < ANGULAR || 1 - cosine < ANGULAR) return 1;
    section.centre = (-radius / (1 + cosine)) * (a.normal + b.normal);
    section.contact1 = section.centre + radius * a.normal;
    section.contact2 = section.centre + radius * b.normal;
    if (dot(section.contact1, a.into) <= 0 || dot(section.contact2, b.into) <= 0) return 1;
    return 0;
}

int cylinder_section(Side plane, Side cylinder, Vec d, double radius, Vec& centre, Vec& on_plane, Vec& on_cylinder)
{
    if (cylinder.radius > 0 && radius >= cylinder.radius) return 1;
    const Vec axis = -cylinder.radius * cylinder.normal;
    const double reach = std::fabs(cylinder.radius - radius);
    const Vec along = cross(d, plane.normal);
    const Vec q = -radius * plane.normal - axis;
    const double b = dot(q, along);
    const double discriminant = b * b - dot(q, q) + reach * reach;
    if (discriminant < 0) return 1;
    const double root = std::sqrt(discriminant);
    const double t = std::fabs(-b - root) < std::fabs(-b + root) ? -b - root : -b + root;
    centre = -radius * plane.normal + t * along;
    on_plane = t * along;
    const Vec outward = centre - axis;
    on_cylinder = axis + (std::fabs(cylinder.radius) / std::sqrt(dot(outward, outward))) * outward;
    return 0;
}

void write_section(int at, Vec p0, Vec p1, Section section)
{
    for (int end = 0; end < 2; end++) {
        const Vec from = end == 0 ? p0 : p1;
        write(at + 9 * end, from + section.centre);
        write(at + 9 * end + 3, from + section.contact1);
        write(at + 9 * end + 6, from + section.contact2);
    }
}

}

extern "C" double* buffer() { return io; }

extern "C" int fillet_planes()
{
    require_finite(FILLET_INPUTS);
    const Vec p0 = read(0), p1 = read(3);
    const Side a = {read(6), read(9), 0}, b = {read(12), read(15), 0};
    const double radius = io[18];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (radius <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    if (std::fabs(dot(a.normal, d)) > ANGULAR || std::fabs(dot(b.normal, d)) > ANGULAR) return 1;
    Section section;
    if (plane_section(a, b, radius, section)) return 1;
    write_section(FILLET_INPUTS, p0, p1, section);
    return 0;
}

extern "C" int fillet_section()
{
    require_finite(CHAMFER_INPUTS);
    const Vec p0 = read(0), p1 = read(3);
    const Side sides[2] = {{read(6), read(9), io[12]}, {read(13), read(16), io[19]}};
    const double radius = io[20];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (radius <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    for (const Side& side : sides) {
        if (std::fabs(dot(side.normal, d)) > ANGULAR || std::fabs(dot(side.into, d)) > ANGULAR) return 1;
    }
    Section section;
    if (sides[0].radius == 0 && sides[1].radius == 0) {
        if (plane_section(sides[0], sides[1], radius, section)) return 1;
    } else if (sides[0].radius == 0 || sides[1].radius == 0) {
        if (1 - std::fabs(dot(sides[0].normal, sides[1].normal)) < ANGULAR) return 1;
        const bool cylinder_first = sides[0].radius != 0;
        const Side& plane = sides[cylinder_first ? 1 : 0];
        const Side& cylinder = sides[cylinder_first ? 0 : 1];
        Vec on_plane, on_cylinder;
        if (cylinder_section(plane, cylinder, d, radius, section.centre, on_plane, on_cylinder)) return 1;
        section.contact1 = cylinder_first ? on_cylinder : on_plane;
        section.contact2 = cylinder_first ? on_plane : on_cylinder;
        if (dot(section.contact1, sides[0].into) <= 0 || dot(section.contact2, sides[1].into) <= 0) return 1;
    } else {
        return 1;
    }
    write_section(CHAMFER_INPUTS, p0, p1, section);
    return 0;
}

extern "C" int chamfer_section()
{
    require_finite(CHAMFER_INPUTS);
    const Vec p0 = read(0), p1 = read(3);
    const Side sides[2] = {{read(6), read(9), io[12]}, {read(13), read(16), io[19]}};
    const double distance = io[20];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (distance <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    for (const Side& side : sides) {
        if (std::fabs(dot(side.normal, d)) > ANGULAR || std::fabs(dot(side.into, d)) > ANGULAR) return 1;
        if (side.radius != 0 && distance > 2 * std::fabs(side.radius)) return 1;
    }
    if (1 - std::fabs(dot(sides[0].normal, sides[1].normal)) < ANGULAR) return 1;
    for (int end = 0; end < 2; end++) {
        const Vec at = end == 0 ? p0 : p1;
        write(CHAMFER_INPUTS + 6 * end, chamfer_contact(at, sides[0], distance));
        write(CHAMFER_INPUTS + 6 * end + 3, chamfer_contact(at, sides[1], distance));
    }
    return 0;
}
