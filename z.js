const data=[
    {
        "dateOfBirth": "2024-02-12",
        "name": "Lakshmi Devi G",
        "userName": "Laxmidevi",
        "image": "http://49.207.183.18:2023/uploads/profile/kst62.jpg",
        "employeeId": "kst62"
    },
    {
        "dateOfBirth": "2024-02-12",
        "name": "test",
        "userName": "test",
        "image": "www",
        "employeeId": "dummy"
    }
];
const filteredData = data.filter((item) => {
    return item.employeeId !== "kst62";
});

console.log(filteredData);