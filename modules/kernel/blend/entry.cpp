#include <cmath>

namespace
{

constexpr int INPUTS = 19;
constexpr int OUTPUTS = 18;
constexpr double ANGULAR = 1e-9;

double io[INPUTS + OUTPUTS];

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
    io[INPUTS + at] = v.x;
    io[INPUTS + at + 1] = v.y;
    io[INPUTS + at + 2] = v.z;
}

}

extern "C" double* buffer() { return io; }

extern "C" int fillet_planes()
{
    for (int i = 0; i < INPUTS; i++) {
        if (!std::isfinite(io[i])) __builtin_trap();
    }
    const Vec p0 = read(0), p1 = read(3), n1 = read(6), w1 = read(9), n2 = read(12), w2 = read(15);
    const double radius = io[18];
    const double length = std::sqrt(dot(p1 - p0, p1 - p0));
    if (radius <= 0 || length <= 0) return 1;
    const Vec d = (1 / length) * (p1 - p0);
    if (std::fabs(dot(n1, d)) > ANGULAR || std::fabs(dot(n2, d)) > ANGULAR) return 1;
    const double cosine = dot(n1, n2);
    if (1 + cosine < ANGULAR || 1 - cosine < ANGULAR) return 1;
    const Vec centre = (-radius / (1 + cosine)) * (n1 + n2);
    const Vec contact1 = centre + radius * n1, contact2 = centre + radius * n2;
    if (dot(contact1, w1) <= 0 || dot(contact2, w2) <= 0) return 1;
    for (int end = 0; end < 2; end++) {
        const Vec at = end == 0 ? p0 : p1;
        write(9 * end, at + centre);
        write(9 * end + 3, at + contact1);
        write(9 * end + 6, at + contact2);
    }
    return 0;
}
